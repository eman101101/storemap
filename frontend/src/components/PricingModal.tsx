/**
 * PricingModal — the plans & photo-storage explainer. Opened from the
 * "Free w/ 1000 Photos" pill on the home page and from "Plan & credits" in
 * the account menu. Two short lines: the free plan, and pay-as-you-go
 * storage charged by the MBs of images stored — no plans or prices listed
 * here; signed-in accounts just fill up an amount (like a fuel pump).
 * Billing itself is not wired (self-host reality); hosted installs hook
 * their payment provider where addStorage lands.
 */
import { useState } from 'react';
import { Modal } from './ui';
import { api } from '../api';
import { useAuth } from '../App';

const mb = (bytes: number) => `${(bytes / 1048576).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;

export default function PricingModal({ onClose }: { onClose: () => void }) {
  const { user, refresh } = useAuth();
  const [amount, setAmount] = useState(250);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const fillUp = async () => {
    setBusy(true);
    setError('');
    try {
      await api.addStorage(amount);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add storage');
    } finally {
      setBusy(false);
    }
  };

  const used = user?.photo_bytes_used ?? 0;
  const quota = user?.photo_bytes_quota ?? 209715200;
  const pct = Math.min(100, Math.round((used / quota) * 100));

  return (
    <Modal title="Plans & photo storage" onClose={onClose} wide>
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="card" style={{ margin: 0, borderColor: 'var(--green)' }}>
          <div className="row-between">
            <h3 style={{ margin: 0 }}>Free</h3>
            <span className="badge" style={{ borderColor: 'var(--green)', color: 'var(--green)' }}>
              Free w/ 1000 Photos
            </span>
          </div>
          <p style={{ fontSize: 13, margin: '6px 0 0' }}>
            Create maps with up to 1,000 product photos per account — free.
          </p>
        </div>

        <div className="card" style={{ margin: 0 }}>
          <div className="row-between">
            <h3 style={{ margin: 0 }}>Pay as you go</h3>
            <span className="badge">per MB stored</span>
          </div>
          <p style={{ fontSize: 13, margin: '6px 0 8px' }}>
            Top up your photo storage any time — you're charged by the megabytes you use.
          </p>
          {user && (
            <>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <input
                  className="input"
                  type="number"
                  min={10}
                  max={10240}
                  step={10}
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  aria-label="Storage amount in megabytes"
                  style={{ width: 120 }}
                />
                <span className="muted" style={{ fontSize: 13 }}>MB</span>
                <button type="button" className="btn primary" disabled={busy} onClick={fillUp}>
                  {busy ? 'Adding…' : 'Fill up'}
                </button>
              </div>
              <div style={{ marginTop: 10, height: 6, background: 'var(--line)', borderRadius: 999, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: 'var(--green)' }} />
              </div>
              <p className="muted" style={{ fontSize: 12.5, margin: '6px 0 0' }}>
                {mb(used)} of {mb(quota)} used ({pct}%).
              </p>
            </>
          )}
          {!user && (
            <p className="muted" style={{ fontSize: 12.5, margin: '4px 0 0' }}>
              Sign in to top up.
            </p>
          )}
        </div>
      </div>
      {error && <div className="error-note" style={{ marginTop: 10 }}>{error}</div>}
      <div className="modal-actions">
        <button type="button" className="btn ghost" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}
