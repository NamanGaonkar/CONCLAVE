import { useState } from 'react';
import { PixelPanel } from './PixelPanel';
import { PixelButton } from './PixelButton';
import { Icon } from './Icon';
import type { HarnessConfig } from '@/store/config';

export interface HivePickerProps {
  config: HarnessConfig;
  /** Open the CURRENT harness home in-place (no relaunch). */
  onOpenCurrent: () => void;
}

// Set right before a hive SWITCH so App skips this picker once after the relaunch
// changeHome triggers — otherwise the user would land back on the picker for the
// hive they just chose. App.tsx reads + clears it on mount.
const SKIP_KEY = 'cth.skipHivePickerOnce';

function folderName(path: string): string {
  return path.split('/').filter(Boolean).pop() ?? path;
}

/**
 * HivePicker — the launch-time workspace selector. A "conclave" is a harness home
 * folder: its own agents, memory, tasks, and history. On reopen the user can open
 * the workspace they were in (fast, in-place), jump to a recent one, browse to an
 * existing folder, or start a new one. Switching to a DIFFERENT home goes through
 * changeHome('fresh'), which tears down services and relaunches against it.
 */
export function HivePicker({ config, onOpenCurrent }: HivePickerProps) {
  const current = config.harnessHome;
  const recents = (config.recentHives ?? []).filter((h) => h && h !== current);
  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();

  const openHive = async (path: string) => {
    if (!path) return;
    if (current && path === current) { onOpenCurrent(); return; }
    setError(undefined);
    setBusy(path);
    try {
      window.localStorage.setItem(SKIP_KEY, '1');
      const res = await window.cth.changeHome(path, 'fresh');
      if (!res.ok) {
        window.localStorage.removeItem(SKIP_KEY);
        setError(res.error ?? 'Could not open that folder.');
        setBusy(undefined);
      }
    } catch (e) {
      window.localStorage.removeItem(SKIP_KEY);
      setError(e instanceof Error ? e.message : 'Failed to switch workspace folder');
      setBusy(undefined);
    }
  };

  const browseExisting = async () => {
    setError(undefined);
    const res = await window.cth.chooseFolder();
    if (res.ok) void openHive(res.path);
    else if (res.error !== 'cancelled') setError(res.error);
  };

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: '#0C0A07',
      backgroundImage:
        'radial-gradient(circle at 50% 50%, #14110C 0%, #0C0A07 100%)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 200,
      padding: 32,
      fontFamily: 'Lato, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    }}>
      <div style={{ width: 560, maxWidth: '94vw' }}>
        <PixelPanel variant="dialog" title="SELECT A CONCLAVE WORKSPACE" noPadding>
          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ margin: 0, fontSize: 13, lineHeight: '21px', color: '#D8CEB8' }}>
              A <strong>Conclave workspace</strong> is the folder where the app keeps everything for one
              workspace — its settings, your agents and their memory, tasks, triggers, and history.
              Each workspace is separate and self-contained, so you can run different setups side by side.
              Open the one you were working in, switch to another, or choose a new folder.
            </p>

            {/* CURRENT — the last-used home, the one-click default. */}
            {current && (
              <div>
                <div style={{ fontFamily: 'Lato, sans-serif', fontSize: 11, fontWeight: 700, color: '#FFD15C', marginBottom: 6 }}>
                  CURRENT WORKSPACE
                </div>
                <div style={{
                  display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
                  background: '#1B1710', border: '1px solid #F5AF28', borderRadius: 4
                }}>
                  <Icon name="folder" />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: 'Lato, sans-serif', fontSize: 13, fontWeight: 700, color: '#F5EDD8', lineHeight: '18px' }}>
                      {folderName(current)}
                    </div>
                    <div style={{
                      fontFamily: 'var(--cth-font-mono)', fontSize: 11, color: '#9E937D',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'rtl', textAlign: 'left'
                    }}>{current}</div>
                  </div>
                  <PixelButton variant="primary" size="md" onClick={onOpenCurrent} disabled={!!busy}>
                    open
                  </PixelButton>
                </div>
              </div>
            )}

            {/* RECENTS — other homes this install has opened before. */}
            {recents.length > 0 && (
              <div>
                <div style={{ fontFamily: 'Lato, sans-serif', fontSize: 11, fontWeight: 700, color: '#9E937D', marginBottom: 6 }}>
                  RECENT WORKSPACES
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflowY: 'auto' }}>
                  {recents.map((h) => (
                    <button
                      key={h}
                      onClick={() => openHive(h)}
                      disabled={!!busy}
                      title={`Switch to ${h} (reloads the app)`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px',
                        background: '#14110C', border: '1px solid #2A2417', borderRadius: 4,
                        cursor: busy ? 'default' : 'pointer', textAlign: 'left',
                        opacity: busy && busy !== h ? 0.5 : 1
                      }}
                    >
                      <Icon name="folder" />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: 'Lato, sans-serif', fontSize: 12, fontWeight: 600, color: '#F5EDD8' }}>
                          {folderName(h)}
                        </div>
                        <div style={{
                          fontFamily: 'var(--cth-font-mono)', fontSize: 11, color: '#9E937D',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', direction: 'rtl', textAlign: 'left'
                        }}>{h}</div>
                      </div>
                      <span style={{ fontSize: 11, color: '#FFD15C', flexShrink: 0 }}>
                        {busy === h ? 'opening…' : 'switch →'}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ERROR */}
            {error && (
              <div style={{
                padding: '8px 12px', background: '#321B17', border: '1px solid #E06D53', borderRadius: 4,
                fontFamily: 'Lato, sans-serif', fontSize: 12, color: '#FF8A65'
              }}>
                {error}
              </div>
            )}

            {/* ACTIONS */}
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              paddingTop: 8, borderTop: '1px solid #2A2417'
            }}>
              <span style={{ fontSize: 11, color: '#9E937D' }}>
                Tip: workspace folders can be moved or backed up anytime.
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <PixelButton variant="secondary" size="md" onClick={browseExisting} disabled={!!busy}>
                  <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    <Icon name="folder" /> browse folder…
                  </span>
                </PixelButton>
              </div>
            </div>
          </div>
        </PixelPanel>
      </div>
    </div>
  );
}
