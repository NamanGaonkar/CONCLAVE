import { PixelPanel } from '@/components/PixelPanel';
import { useResolvedGodName } from '@/hooks/useResolvedGodName';

/**
 * Loader shown on the metro floor while the lead agent is initializing on
 * launch. Replaces the "add agent" prompt so a returning user doesn't see the
 * empty-floor call-to-action before the lead has booted.
 */
export function MichaelBooting() {
  const godName = useResolvedGodName();
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      pointerEvents: 'none'
    }}>
      <div style={{ pointerEvents: 'auto', width: 380 }}>
        <PixelPanel variant="dialog" title="LEAD INITIALIZING" noPadding>
          <div style={{
            padding: 24,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16
          }}>
            <div style={{ display: 'flex', gap: 8 }}>
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 12, height: 12,
                    borderRadius: 2,
                    background: '#F5AF28',
                    boxShadow: '0 0 10px rgba(245, 175, 40, 0.6)',
                    animation: 'cth-blink 1s ease-in-out infinite alternate',
                    animationDelay: `${i * 0.2}s`
                  }}
                />
              ))}
            </div>
            <p style={{
              margin: 0, fontSize: 13, lineHeight: '20px', textAlign: 'center',
              color: 'var(--cth-ink-700)'
            }}>
              {godName} is initializing the Conclave transit network and readying the lines. Hang tight…
            </p>
          </div>
        </PixelPanel>
      </div>
    </div>
  );
}
