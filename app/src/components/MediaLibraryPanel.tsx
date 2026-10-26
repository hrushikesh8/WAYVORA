/* ─── Media Library Studio Panel ─────────────────────────────────────
   Local-first asset manager providing drag-and-drop file import,
   type filtering, search, thumbnail previews, and scene/audio integration.
   ─────────────────────────────────────────────────────────────────── */

import React, { useState, useRef, useMemo } from 'react';
import type { Journey, StoryScene } from '../domain/types';
import type { MediaAsset, MediaType } from '../domain/media/types';
import { filterMediaLibrary } from '../domain/media/mediaLifecycle';

interface MediaLibraryPanelProps {
  journey: Journey;
  onImportFiles: (files: FileList | File[]) => Promise<void>;
  onDeleteAsset: (assetId: string) => void;
  onAssignToScene: (sceneId: string, assetId: string) => void;
  onAssignToAudioTrack: (trackId: string, asset: MediaAsset) => void;
  onPreviewAsset: (asset: MediaAsset) => void;
  isImporting: boolean;
  importMessage: string | null;
}

export function MediaLibraryPanel({
  journey,
  onImportFiles,
  onDeleteAsset,
  onAssignToScene,
  onAssignToAudioTrack,
  onPreviewAsset,
  isImporting,
  importMessage,
}: MediaLibraryPanelProps) {
  const [filterType, setFilterType] = useState<MediaType | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const library = journey.mediaLibrary ?? [];
  const scenes = (journey.timeline.scenes ?? []) as StoryScene[];
  const audioTracks = journey.audio?.tracks ?? [];

  // Filtered asset list
  const filteredAssets = useMemo(() => {
    return filterMediaLibrary(library, {
      type: filterType,
      searchQuery,
    });
  }, [library, filterType, searchQuery]);

  // Counts
  const photoCount = useMemo(() => library.filter((a) => a.type === 'photo').length, [library]);
  const videoCount = useMemo(() => library.filter((a) => a.type === 'video').length, [library]);
  const audioCount = useMemo(() => library.filter((a) => a.type === 'audio').length, [library]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onImportFiles(e.dataTransfer.files);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      onImportFiles(e.target.files);
      // Reset input so importing the same file again triggers change
      e.target.value = '';
    }
  };

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDuration = (seconds?: number): string => {
    if (!seconds) return '';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="media-library-panel">
      {/* Panel Section Header */}
      <div className="section-label">
        <span>Local Media Library & Provenance</span>
      </div>

      {/* Drag & Drop Import Dropzone */}
      <div
        className={`media-dropzone ${isDragOver ? 'drag-over' : ''} ${isImporting ? 'importing' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isImporting && fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/*,video/mp4,video/webm,video/ogg,audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac"
          style={{ display: 'none' }}
          onChange={handleFileInputChange}
        />
        <div className="dropzone-content">
          <span className="dropzone-icon">📥</span>
          <div className="dropzone-text">
            <strong>{isImporting ? 'Importing media...' : 'Drop Photos, Videos, or Audio here'}</strong>
            <span>or click to browse files from your computer</span>
          </div>
          <div className="dropzone-badges">
            <span className="format-tag">Photos (JPG, PNG, WebP)</span>
            <span className="format-tag">Videos (MP4, WebM)</span>
            <span className="format-tag">Audio (MP3, WAV, AAC)</span>
          </div>
        </div>
      </div>

      {/* Import Status / Notification Banner */}
      {importMessage && (
        <div className="media-import-banner">
          <span>{importMessage}</span>
        </div>
      )}

      {/* Search & Filter Bar */}
      <div className="media-filter-bar">
        <div className="media-search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            placeholder="Search by name, title, or camera..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="btn-clear-search" onClick={() => setSearchQuery('')}>
              ×
            </button>
          )}
        </div>

        <div className="media-filter-pills">
          <button
            className={`pill-btn ${filterType === 'all' ? 'active' : ''}`}
            onClick={() => setFilterType('all')}
          >
            All ({library.length})
          </button>
          <button
            className={`pill-btn ${filterType === 'photo' ? 'active' : ''}`}
            onClick={() => setFilterType('photo')}
          >
            📷 Photos ({photoCount})
          </button>
          <button
            className={`pill-btn ${filterType === 'video' ? 'active' : ''}`}
            onClick={() => setFilterType('video')}
          >
            🎬 Videos ({videoCount})
          </button>
          <button
            className={`pill-btn ${filterType === 'audio' ? 'active' : ''}`}
            onClick={() => setFilterType('audio')}
          >
            🎵 Audio ({audioCount})
          </button>
        </div>
      </div>

      {/* Assets Grid */}
      {filteredAssets.length === 0 ? (
        <div className="media-empty-state">
          {library.length === 0 ? (
            <>
              <span className="empty-icon">🖼️</span>
              <h4>Your Media Library is Empty</h4>
              <p>Import your travel photos, drone videos, and music files to craft authentic cinematic stories.</p>
            </>
          ) : (
            <>
              <span className="empty-icon">🔍</span>
              <h4>No matching assets found</h4>
              <p>Try refining your search keyword or clearing the active filter.</p>
            </>
          )}
        </div>
      ) : (
        <div className="media-cards-grid">
          {filteredAssets.map((asset) => {
            const isPhoto = asset.type === 'photo';
            const isVideo = asset.type === 'video';
            const isAudio = asset.type === 'audio';

            return (
              <div key={asset.id} className={`media-asset-card ${asset.isMissing ? 'asset-missing' : ''}`}>
                {/* Visual Thumbnail */}
                <div className="card-thumb-container" onClick={() => onPreviewAsset(asset)}>
                  {asset.isMissing ? (
                    <div className="thumb-missing-placeholder">
                      <span>⚠️</span>
                      <small>Missing</small>
                    </div>
                  ) : isPhoto ? (
                    <img src={asset.url} alt={asset.filename} className="card-thumb-img" />
                  ) : isVideo ? (
                    <div className="thumb-video-placeholder">
                      <video src={asset.url} preload="metadata" muted className="card-thumb-video" />
                      <span className="video-play-badge">▶</span>
                    </div>
                  ) : isAudio ? (
                    <div className="thumb-audio-placeholder">
                      <span className="audio-icon">🎵</span>
                      {asset.durationSeconds && (
                        <span className="audio-dur-badge">{formatDuration(asset.durationSeconds)}</span>
                      )}
                    </div>
                  ) : null}

                  {/* Type Badge */}
                  <span className={`asset-type-badge badge-${asset.type}`}>
                    {asset.type.toUpperCase()}
                  </span>
                </div>

                {/* Card Metadata Details */}
                <div className="card-meta-details">
                  <h4 className="asset-title" title={asset.filename}>
                    {asset.title || asset.filename}
                  </h4>

                  <div className="asset-sub-meta">
                    <span className="file-size">{formatFileSize(asset.sizeBytes)}</span>
                    {asset.width && asset.height && (
                      <span className="file-dims">{asset.width}×{asset.height}</span>
                    )}
                    {asset.durationSeconds && !isPhoto && (
                      <span className="file-dur">{formatDuration(asset.durationSeconds)}</span>
                    )}
                  </div>

                  {/* EXIF Highlights */}
                  {asset.geoPosition && (
                    <div className="asset-exif-chip" title="Authentic EXIF GPS coordinates">
                      📍 {asset.geoPosition.lat.toFixed(2)}°, {asset.geoPosition.lng.toFixed(2)}°
                      {asset.geoPosition.ele && ` (${Math.round(asset.geoPosition.ele)}m)`}
                    </div>
                  )}

                  {/* Actions Footer */}
                  <div className="asset-card-actions">
                    <button
                      className="btn-card-action"
                      onClick={() => onPreviewAsset(asset)}
                      title="Inspect metadata and preview"
                    >
                      👁️ Inspect
                    </button>

                    {/* Quick Scene Assign for Visuals */}
                    {(isPhoto || isVideo) && scenes.length > 0 && (
                      <select
                        className="select-quick-assign"
                        onChange={(e) => {
                          if (e.target.value) {
                            onAssignToScene(e.target.value, asset.id);
                            e.target.value = '';
                          }
                        }}
                        defaultValue=""
                        title="Add to a Story Scene"
                      >
                        <option value="" disabled>+ Scene</option>
                        {scenes.map((sc, sIdx) => (
                          <option key={sc.id} value={sc.id}>
                            Scene #{sIdx + 1}: {sc.title || sc.name}
                          </option>
                        ))}
                      </select>
                    )}

                    {/* Quick Track Assign for Audio */}
                    {isAudio && audioTracks.length > 0 && (
                      <select
                        className="select-quick-assign"
                        onChange={(e) => {
                          if (e.target.value) {
                            onAssignToAudioTrack(e.target.value, asset);
                            e.target.value = '';
                          }
                        }}
                        defaultValue=""
                        title="Add to Audio Timeline"
                      >
                        <option value="" disabled>+ Track</option>
                        {audioTracks.map((tr) => (
                          <option key={tr.id} value={tr.id}>
                            {tr.name}
                          </option>
                        ))}
                      </select>
                    )}

                    <button
                      className="btn-card-delete"
                      onClick={() => {
                        if (window.confirm(`Delete "${asset.filename}" from your library?`)) {
                          onDeleteAsset(asset.id);
                        }
                      }}
                      title="Delete asset"
                    >
                      🗑
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
