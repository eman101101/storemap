/**
 * PricingModal — the plans & photo-credits explainer. Opened from the
 * top-nav's "Free w/ 1000 Photos" pill (signed out) and from "Plan &
 * credits" in the account menu (signed in — user settings). The free plan
 * includes 1000 product photos per account; beyond that, pay-as-you-go
 * credit packs top the account up at the underlying Cloudflare R2 cost
 * (storage + ops). Adding credits is instant on self-hosted/local installs;
 * hosted deployments hook their payment provider where addCredits lands.
 */
import { useState } from 'react';
import { Modal } from './ui';
import { api } from '../api';
import { useAuth } from '../App';

/** Credit packs (mirrors the backend's CREDIT_PACKS pricing). */
const PACKS: { id: 'small' | 'medium' | 'large'; credits: number; price: string }[] = [
  { id: 'small', credits: 1000, price: '$1' },
  { id: 'medium', credits: 5000, price: '$4' },
  { id: 'large', credits: 20000, price: '$12' },
];

export default function PricingModal({ onClose }: { onClose: () => void }) {
  const { user, refresh } = useAuth();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const addCredits = async (pack: 'small' | 'medium' | 'large') => {
    setBusy(pack);
    setError('');
    try {
      await api.addCredits(pack);
      await refresh(); // the avatar menu / plan line re-reads photo_credits
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not add credits');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Modal title="Plans & photo credits" onClose={onClose} wide>
      <div style={{ display: 'grid', gap: 12 }}>
        <div className="card" style={{ margin: 0, borderColor: 'var(--green)' }}>
          <div className="row-between">
            <h3 style={{ margin: 0 }}>Free</h3>
            <span className="badge" style={{ borderColor: 'var(--green)', color: 'var(--green)' }}>
              Free w/ 1000 Photos
            </span>
          </div>
          <p className="muted" style={{ fontSize: 13, margin: '6px 0 0' }}>
            Create maps, pin products, and share public store pages with shoppers — with up to
            <b> 1,000 product photos per account</b>. No card, no time limit. Every new account
            starts with its 1,000 photo credits on the account.
          </p>
        </div>

        <div className="card" style={{ margin: 0 }}>
          <div className="row-between">
            <h3 style={{ margin: 0 }}>Pay as you go</h3>
            <span className="badge">photo credits</span>
          </div>
          <p className="muted" style={{ fontSize: 13, margin: '6px 0 8px' }}>
            Outgrown 1,000 photos? Add credit packs to your account — <b>1 credit = 1 photo upload</b>.
            Pricing follows the underlying Cloudflare R2 rates (storage $0.015/GB·month, writes
            $4.50/million, reads $0.36/million — a ~200 KB photo costs well under a cent a year),
            rounded to friendly amounts. Credits never expire.
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {PACKS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="btn"
                disabled={!user || busy !== null}
                onClick={() => addCredits(p.id)}
                title={user ? `Add ${p.credits.toLocaleString()} credits to your account` : 'Sign in to add credits'}
              >
                {busy === p.id ? 'Adding…' : `+${p.credits.toLocaleString()} credits · ${p.price}`}
              </button>
            ))}
          </div>
          {user ? (
            <p className="muted" style={{ fontSize: 12.5, margin: '8px 0 0' }}>
              Your account: <b>{(user.photo_credits ?? 0).toLocaleString()}</b> photo
              {((user.photo_credits ?? 0) === 1 ? ' credit' : ' credits')} on this device's session.
            </p>
          ) : (
            <p className="muted" style={{ fontSize: 12.5, margin: '8px 0 0' }}>
              Sign in to add credits — they land on your account and are spent automatically as you
              upload product photos.
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
