/* ─── Place Search & Geocoding Autocomplete Component ─────────────────
   Production-ready search-as-you-type autocomplete with keyboard navigation,
   debouncing, request cancellation, rate-limit protection, and
   direct route waypoint integration.
   ─────────────────────────────────────────────────────────────────── */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { GeocodingAdapter, GeocodeResult, GeocodeErrorDetails } from '../domain/geocoding/types';
import { PhotonGeocodingAdapter } from '../domain/geocoding/photon';

export interface PlaceSearchProps {
  adapter?: GeocodingAdapter;
  onSelectPlace: (place: GeocodeResult) => void;
  onAddPlaceToJourney?: (place: GeocodeResult) => void;
  selectedPlace?: GeocodeResult | null;
  onClearSelection?: () => void;
  className?: string;
  proximityBias?: { lat: number; lng: number };
}

export function getCategoryIcon(category?: string, type?: string): string {
  if (category === 'natural' || type === 'peak' || type === 'volcano') return '🏔️';
  if (type === 'city') return '🏙️';
  if (type === 'town' || type === 'village' || type === 'suburb') return '🏘️';
  if (category === 'tourism' || type === 'hotel' || type === 'attraction') return '🏛️';
  if (category === 'highway' || type === 'road') return '🛣️';
  if (category === 'water' || type === 'lake' || type === 'bay') return '⛵';
  if (category === 'aeroway' || type === 'aerodrome') return '✈️';
  return '📍';
}

export const PlaceSearch: React.FC<PlaceSearchProps> = ({
  adapter: customAdapter,
  onSelectPlace,
  onAddPlaceToJourney,
  selectedPlace,
  onClearSelection,
  className = '',
  proximityBias,
}) => {
  // Use Photon by default; swappable via props
  const adapterRef = useRef<GeocodingAdapter>(customAdapter ?? new PhotonGeocodingAdapter());
  useEffect(() => {
    if (customAdapter) {
      adapterRef.current = customAdapter;
    }
  }, [customAdapter]);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<GeocodeResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [error, setError] = useState<GeocodeErrorDetails | null>(null);
  const [addedSuccess, setAddedSuccess] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Close dropdown on outside click
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, []);

  // Cleanup abort controller on unmount
  useEffect(() => {
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, []);

  // Execute search with debounce and stale-request protection
  const executeSearch = useCallback((searchTerm: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const trimmed = searchTerm.trim();
    if (!trimmed) {
      setResults([]);
      setIsLoading(false);
      setError(null);
      setIsOpen(false);
      return;
    }

    setIsLoading(true);
    setError(null);
    setIsOpen(true);
    setSelectedIndex(-1);

    debounceTimerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const response = await adapterRef.current.search({
          query: trimmed,
          limit: 6,
          lat: proximityBias?.lat,
          lng: proximityBias?.lng,
          signal: controller.signal,
        });

        if (controller.signal.aborted) return;

        if (response.success) {
          setResults(response.results);
          setError(null);
        } else if (response.error && response.error.code !== 'ABORTED') {
          setError(response.error);
          setResults([]);
        }
      } catch (err: unknown) {
        if (!controller.signal.aborted) {
          setError({
            code: 'NETWORK_ERROR',
            message: err instanceof Error ? err.message : 'Search failed. Please try again.',
          });
          setResults([]);
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }, 280);
  }, [proximityBias]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    executeSearch(val);
  };

  const handleClear = () => {
    setQuery('');
    setResults([]);
    setError(null);
    setIsOpen(false);
    setSelectedIndex(-1);
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    if (abortControllerRef.current) abortControllerRef.current.abort();
    inputRef.current?.focus();
  };

  const handleSelect = (place: GeocodeResult) => {
    setIsOpen(false);
    setQuery(place.name);
    setAddedSuccess(false);
    onSelectPlace(place);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
      inputRef.current?.blur();
      return;
    }

    if (!isOpen || (results.length === 0 && !error)) {
      if (e.key === 'ArrowDown' && query.trim()) {
        executeSearch(query);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < results.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : results.length - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = selectedIndex >= 0 ? results[selectedIndex] : results[0];
      if (target) {
        handleSelect(target);
      }
    }
  };

  const handleAddToJourney = (place: GeocodeResult) => {
    if (onAddPlaceToJourney) {
      onAddPlaceToJourney(place);
      setAddedSuccess(true);
      setTimeout(() => setAddedSuccess(false), 3000);
    }
  };

  return (
    <div
      ref={containerRef}
      className={`wayvora-place-search ${className}`}
      style={{
        position: 'relative',
        width: '340px',
        maxWidth: 'calc(100vw - 32px)',
        zIndex: 40,
        fontFamily: 'var(--font-body, Inter, sans-serif)',
      }}
    >
      {/* Search Input Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          background: 'rgba(15, 23, 42, 0.88)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '12px',
          padding: '6px 12px',
          boxShadow: '0 12px 28px -6px rgba(0, 0, 0, 0.6), 0 0 1px 1px rgba(255, 255, 255, 0.05)',
          transition: 'all 0.2s ease',
        }}
      >
        <span style={{ fontSize: '15px', opacity: 0.8, userSelect: 'none' }}>🔍</span>

        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={() => {
            if (results.length > 0 || error) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search places, cities, peaks..."
          aria-label="Search places and landmarks"
          aria-autocomplete="list"
          aria-expanded={isOpen}
          style={{
            flex: 1,
            background: 'transparent',
            border: 'none',
            outline: 'none',
            color: '#f8fafc',
            fontSize: '13px',
            fontWeight: 500,
          }}
        />

        {isLoading && (
          <span
            style={{
              display: 'inline-block',
              width: '14px',
              height: '14px',
              border: '2px solid rgba(0, 242, 254, 0.25)',
              borderTopColor: '#00f2fe',
              borderRadius: '50%',
              animation: 'spin 0.7s linear infinite',
            }}
          />
        )}

        {query && !isLoading && (
          <button
            type="button"
            onClick={handleClear}
            title="Clear search"
            aria-label="Clear search"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '16px',
              padding: '0 4px',
              cursor: 'pointer',
              lineHeight: 1,
            }}
          >
            ×
          </button>
        )}
      </div>

      {/* Autocomplete Dropdown */}
      {isOpen && (
        <div
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            background: 'rgba(15, 23, 42, 0.96)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255, 255, 255, 0.14)',
            borderRadius: '12px',
            overflow: 'hidden',
            boxShadow: '0 20px 35px -8px rgba(0, 0, 0, 0.75)',
            maxHeight: '340px',
            overflowY: 'auto',
          }}
        >
          {error ? (
            <div style={{ padding: '12px 14px', fontSize: '12px', color: '#f87171' }}>
              <div style={{ fontWeight: 600, marginBottom: '2px' }}>
                {error.code === 'RATE_LIMITED' ? '⏱ Rate Limited' : '⚠ Search Unavailable'}
              </div>
              <div style={{ opacity: 0.85 }}>{error.message}</div>
            </div>
          ) : results.length === 0 ? (
            <div style={{ padding: '14px', fontSize: '12px', color: '#94a3b8', textAlign: 'center' }}>
              {isLoading ? 'Searching global locations...' : `No locations found for "${query}"`}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              {results.map((res, index) => {
                const isSelected = index === selectedIndex;
                const icon = getCategoryIcon(res.category, res.type);

                return (
                  <div
                    key={res.id}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(res)}
                    onMouseEnter={() => setSelectedIndex(index)}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: '10px',
                      padding: '9px 12px',
                      cursor: 'pointer',
                      borderBottom: index < results.length - 1 ? '1px solid rgba(255, 255, 255, 0.05)' : 'none',
                      background: isSelected ? 'rgba(0, 242, 254, 0.12)' : 'transparent',
                      transition: 'background 0.15s ease',
                    }}
                  >
                    <span style={{ fontSize: '16px', lineHeight: 1.2, marginTop: '1px' }}>{icon}</span>

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: '13px',
                          fontWeight: 600,
                          color: isSelected ? '#38bdf8' : '#f8fafc',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {res.name}
                      </div>

                      <div
                        style={{
                          fontSize: '11px',
                          color: '#94a3b8',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          marginTop: '1px',
                        }}
                      >
                        {res.displayName}
                      </div>
                    </div>

                    <div
                      style={{
                        fontSize: '9px',
                        color: '#64748b',
                        fontFamily: 'monospace',
                        alignSelf: 'center',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {res.lat.toFixed(2)}°, {res.lng.toFixed(2)}°
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Transparent Provider Attribution */}
          <div
            style={{
              padding: '6px 12px',
              fontSize: '10px',
              color: '#64748b',
              background: 'rgba(2, 6, 23, 0.7)',
              borderTop: '1px solid rgba(255, 255, 255, 0.06)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <span>{adapterRef.current.attribution}</span>
            <span>OSM Data</span>
          </div>
        </div>
      )}

      {/* Selected Place Card (when inspector has active selection) */}
      {selectedPlace && !isOpen && (
        <div
          style={{
            marginTop: '8px',
            background: 'rgba(15, 23, 42, 0.92)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(0, 242, 254, 0.35)',
            borderRadius: '12px',
            padding: '12px 14px',
            boxShadow: '0 16px 32px -6px rgba(0, 0, 0, 0.65), 0 0 16px rgba(0, 242, 254, 0.15)',
            animation: 'fadeIn 0.2s ease',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ fontSize: '14px' }}>
                  {getCategoryIcon(selectedPlace.category, selectedPlace.type)}
                </span>
                <span style={{ fontSize: '14px', fontWeight: 700, color: '#f8fafc' }}>
                  {selectedPlace.name}
                </span>
                {selectedPlace.type && (
                  <span
                    style={{
                      fontSize: '9px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      background: 'rgba(56, 189, 248, 0.15)',
                      color: '#38bdf8',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      fontWeight: 600,
                    }}
                  >
                    {selectedPlace.type}
                  </span>
                )}
              </div>

              <div
                style={{
                  fontSize: '11px',
                  color: '#94a3b8',
                  marginTop: '3px',
                  lineHeight: 1.3,
                }}
              >
                {selectedPlace.displayName}
              </div>

              <div
                style={{
                  fontSize: '10px',
                  color: '#64748b',
                  fontFamily: 'monospace',
                  marginTop: '4px',
                }}
              >
                Coordinates: {selectedPlace.lat.toFixed(5)}° N, {selectedPlace.lng.toFixed(5)}° E
              </div>
            </div>

            {onClearSelection && (
              <button
                type="button"
                onClick={onClearSelection}
                title="Dismiss place marker"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#64748b',
                  fontSize: '16px',
                  cursor: 'pointer',
                  padding: '0 2px',
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            )}
          </div>

          {/* Action Button: Add to Journey */}
          {onAddPlaceToJourney && (
            <div style={{ marginTop: '10px', display: 'flex', gap: '8px', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => handleAddToJourney(selectedPlace)}
                style={{
                  flex: 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  background: addedSuccess
                    ? 'linear-gradient(135deg, #10b981 0%, #059669 100%)'
                    : 'linear-gradient(135deg, #00f2fe 0%, #4facfe 100%)',
                  color: '#050b14',
                  fontWeight: 600,
                  fontSize: '11px',
                  padding: '7px 12px',
                  borderRadius: '6px',
                  cursor: 'pointer',
                  boxShadow: '0 4px 12px rgba(0, 242, 254, 0.25)',
                  transition: 'all 0.2s ease',
                }}
              >
                {addedSuccess ? '✓ Added to Journey' : '+ Add Waypoint to Journey'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
