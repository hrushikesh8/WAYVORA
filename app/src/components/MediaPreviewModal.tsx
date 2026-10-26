/* ─── Media Preview & Provenance Inspector Modal ─────────────────────
   Interactive preview dialog for user-imported photos, videos, and audio.
   Displays full-resolution preview and inspects genuine EXIF/format metadata.
   ─────────────────────────────────────────────────────────────────── */

import type { MediaAsset } from '../domain/media/types';
import type { StoryScene } from '../domain/types';
import type { AudioTrack } from '../domain/audio/types';

interface MediaPreviewModalProps {
  asset: MediaAsset | null;
  onClose: () => void;
  scenes?: StoryScene[];
  audioTracks?: AudioTrack[];
  onAssignToScene?: (sceneId: string, assetId: string) => void;
  onAssignToAudioTrack?: (trackId: string, asset: MediaAsset) => void;
  onDeleteAsset?: (assetId: string) => void;
}

export function MediaPreviewModal({
  asset,
  onClose,
  scenes = [],
  audioTracks = [],
  onAssignToScene,
  onAssignToAudioTrack,
  onDeleteAsset,
}: MediaPreviewModalProps) {
  if (!asset) return null;

  const isPhoto = asset.type === 'photo';
  const isVideo = asset.type === 'video';
  const isAudio = asset.type === 'audio';

  const formatFileSize = (bytes?: number): string => {
    if (!bytes) return 'Unknown size';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const formatDuration = (seconds?: number): string => {
    if (!seconds) return '0:00';
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="media-modal-backdrop" onClick={onClose}>
      <div className="media-modal-content" onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className="media-modal-header">
          <div className="media-modal-title">
            <span className={`media-type-pill pill-${asset.type}`}>
              {asset.type.toUpperCase()}
            </span>
            <h3>{asset.title || asset.filename}</h3>
          </div>
          <button className="btn-close-modal" onClick={onClose} title="Close Preview">
            ✕
          </button>
        </div>

        {/* Modal Body */}
        <div className="media-modal-body">
          {/* Main Visual / Player Area */}
          <div className="media-preview-viewport">
            {asset.isMissing ? (
              <div className="media-missing-card">
                <span style={{ fontSize: '36px' }}>⚠️</span>
                <h4>Source File Missing</h4>
                <p>
                  The original binary data for <code>{asset.filename}</code> could not be found
                  in your browser&apos;s local storage.
                </p>
                <span className="media-hint">
                  Re-importing the file will restore playback and scene rendering.
                </span>
              </div>
            ) : isPhoto ? (
              <div className="media-image-frame">
                <img src={asset.url} alt={asset.filename} className="media-modal-img" />
              </div>
            ) : isVideo ? (
              <div className="media-video-frame">
                <video src={asset.url} controls autoPlay muted className="media-modal-video" />
              </div>
            ) : isAudio ? (
              <div className="media-audio-frame">
                <div className="media-audio-visualizer">
                  <span style={{ fontSize: '48px' }}>🎵</span>
                  <div className="waveform-pulse-bars">
                    <span />
                    <span />
                    <span />
                    <span />
                    <span />
                  </div>
                </div>
                <audio src={asset.url} controls autoPlay className="media-modal-audio" />
              </div>
            ) : null}
          </div>

          {/* Metadata Inspector Sidebar */}
          <div className="media-metadata-sidebar">
            <h4>Asset Inspector</h4>

            <div className="metadata-section">
              <h5>File Provenance</h5>
              <div className="meta-row">
                <span className="meta-label">Filename:</span>
                <span className="meta-val" title={asset.filename}>{asset.filename}</span>
              </div>
              <div className="meta-row">
                <span className="meta-label">Format:</span>
                <span className="meta-val">{asset.mimeType || asset.type}</span>
              </div>
              <div className="meta-row">
                <span className="meta-label">File Size:</span>
                <span className="meta-val">{formatFileSize(asset.sizeBytes)}</span>
              </div>
              {asset.width && asset.height && (
                <div className="meta-row">
                  <span className="meta-label">Dimensions:</span>
                  <span className="meta-val">{asset.width} × {asset.height} px</span>
                </div>
              )}
              {asset.durationSeconds != null && (
                <div className="meta-row">
                  <span className="meta-label">Duration:</span>
                  <span className="meta-val">{formatDuration(asset.durationSeconds)} ({asset.durationSeconds.toFixed(1)}s)</span>
                </div>
              )}
            </div>

            {/* Authentic EXIF Section */}
            <div className="metadata-section">
              <h5>Authentic EXIF Metadata</h5>
              {asset.geoPosition ? (
                <>
                  <div className="meta-row">
                    <span className="meta-label">GPS Lat:</span>
                    <span className="meta-val mono">{asset.geoPosition.lat.toFixed(6)}°</span>
                  </div>
                  <div className="meta-row">
                    <span className="meta-label">GPS Lng:</span>
                    <span className="meta-val mono">{asset.geoPosition.lng.toFixed(6)}°</span>
                  </div>
                  {asset.geoPosition.ele != null && (
                    <div className="meta-row">
                      <span className="meta-label">Elevation:</span>
                      <span className="meta-val mono">{Math.round(asset.geoPosition.ele)} meters</span>
                    </div>
                  )}
                </>
              ) : (
                <div className="meta-row muted">
                  <span className="meta-label">GPS:</span>
                  <span className="meta-val">No GPS coordinates recorded</span>
                </div>
              )}

              {asset.timestamp ? (
                <div className="meta-row">
                  <span className="meta-label">Captured:</span>
                  <span className="meta-val mono">{new Date(asset.timestamp).toLocaleString()}</span>
                </div>
              ) : (
                <div className="meta-row muted">
                  <span className="meta-label">Timestamp:</span>
                  <span className="meta-val">No EXIF timestamp recorded</span>
                </div>
              )}

              {asset.cameraModel && (
                <div className="meta-row">
                  <span className="meta-label">Hardware:</span>
                  <span className="meta-val">{asset.cameraModel}</span>
                </div>
              )}
            </div>

            {/* Storage Fingerprint */}
            <div className="metadata-section">
              <h5>Local Storage & Integrity</h5>
              <div className="meta-row">
                <span className="meta-label">Fingerprint:</span>
                <span className="meta-val mono small" title={asset.fingerprint}>{asset.fingerprint || 'N/A'}</span>
              </div>
              <div className="meta-row">
                <span className="meta-label">Storage Engine:</span>
                <span className="meta-val badge-storage">IndexedDB Local Blob</span>
              </div>
            </div>

            {/* Quick Actions */}
            <div className="metadata-section actions-section">
              <h5>Story & Sound Integration</h5>

              {(isPhoto || isVideo) && scenes.length > 0 && onAssignToScene && (
                <div className="assign-action-row">
                  <span className="action-label">Attach to Story Scene:</span>
                  <select
                    className="select-scene-assign"
                    onChange={(e) => {
                      if (e.target.value) {
                        onAssignToScene(e.target.value, asset.id);
                        onClose();
                      }
                    }}
                    defaultValue=""
                  >
                    <option value="" disabled>Select Story Scene...</option>
                    {scenes.map((sc, idx) => (
                      <option key={sc.id} value={sc.id}>
                        Scene #{idx + 1}: {sc.title || sc.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {isAudio && audioTracks.length > 0 && onAssignToAudioTrack && (
                <div className="assign-action-row">
                  <span className="action-label">Add to Audio Track:</span>
                  <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                    {audioTracks.map((tr) => (
                      <button
                        key={tr.id}
                        className="btn-assign-track"
                        onClick={() => {
                          onAssignToAudioTrack(tr.id, asset);
                          onClose();
                        }}
                      >
                        + {tr.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {onDeleteAsset && (
                <button
                  className="btn-delete-asset"
                  onClick={() => {
                    if (window.confirm(`Delete "${asset.filename}" from your media library?`)) {
                      onDeleteAsset(asset.id);
                      onClose();
                    }
                  }}
                >
                  🗑 Remove from Library
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
