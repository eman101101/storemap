import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth } from '../App';

/** Team management modal — roster, invite with copyable link, role changes. */
export function TeamModal({ storeId, onClose }: { storeId: string; onClose: () => void }) {
  const { user } = useAuth();
  const [members, setMembers] = useState<{ user_id: string; email: string; name: string; role: string }[] | null>(null);
  const [myRole, setMyRole] = useState('viewer');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('stock');
  const [inviteUrl, setInviteUrl] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const load = useCallback(() => { api.members(storeId).then((r) => { setMembers(r.members); setMyRole(r.role); }).catch((e) => setError(e.message)); }, [storeId]);
  useEffect(() => { load(); }, [load]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try {
      const r = await api.inviteMember(storeId, email, role);
      setInviteUrl(r.inviteUrl);
      setEmail('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invite failed');
    }
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const canManage = myRole === 'owner';
  const canInvite = myRole === 'owner' || myRole === 'manager';

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal fade-in" role="dialog" aria-label="Store team" style={{ maxWidth: 540 }}>
        <h3>Team</h3>
        {error && <div className="error-note">{error}</div>}
        {members === null ? (
          <p className="muted">Loading…</p>
        ) : (
          <div className="stack">
            {members.map((m) => (
              <div key={m.user_id} className="member-row">
                <div className="member-info">
                  <b>{m.name || m.email}</b>
                  <span className="muted">{m.email}</span>
                </div>
                <span className={`badge ${m.role === 'owner' ? '' : 'gray'}`}>{m.role}</span>
                {canManage && m.role !== 'owner' && (
                  <>
                    <select
                      className="select"
                      style={{ width: 110 }}
                      value={m.role}
                      onChange={(e) => api.updateMemberRole(storeId, m.user_id, e.target.value).then(load).catch((err) => setError(err.message))}
                    >
                      <option value="manager">manager</option>
                      <option value="stock">stock</option>
                      <option value="viewer">viewer</option>
                    </select>
                    <button
                      className="btn sm ghost"
                      title="Remove from team"
                      onClick={() => api.removeMember(storeId, m.user_id).then(load).catch((err) => setError(err.message))}
                    >
                      ✕
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {canInvite && (
          <>
            <div className="divider">invite</div>
            <form onSubmit={invite} className="field-row">
              <input className="input" type="email" placeholder="employee@shop.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
              <select className="select" style={{ width: 110 }} value={role} onChange={(e) => setRole(e.target.value)}>
                {myRole === 'owner' && <option value="manager">manager</option>}
                <option value="stock">stock</option>
                <option value="viewer">viewer</option>
              </select>
              <button className="btn primary">Invite</button>
            </form>
            {inviteUrl && (
              <div className="invite-link">
                <div className="public-link-row">
                  <code>{inviteUrl}</code>
                  <button className="btn sm" onClick={copyLink}>{copied ? '✓ Copied' : 'Copy link'}</button>
                </div>
                <p className="muted" style={{ fontSize: 12, margin: '6px 0 0' }}>
                  Send this link to the employee — it works for 48 hours and only for {inviteUrl && 'the invited email'}. They sign in with Google (or the demo login on private instances).
                </p>
              </div>
            )}
          </>
        )}
        {!canInvite && <p className="muted" style={{ marginTop: 12 }}>Only owners and managers can invite.</p>}
        <div className="modal-actions">
          <span className="muted" style={{ marginRight: 'auto', fontSize: 12 }}>You are: {myRole}{user ? ` · ${user.email}` : ''}</span>
          <button className="btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/** /invite/:token — preview the invitation, sign in if needed, accept. */
export default function InviteAcceptPage() {
  const { token = '' } = useParams();
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const [info, setInfo] = useState<{ storeName: string; role: string; email: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.invitationInfo(token).then((r) => setInfo(r.invitation)).catch((e) => setError(e.message));
  }, [token]);

  const accept = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await api.acceptInvitation(token);
      await refresh();
      navigate(`/dashboard/stores/${r.storeId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not accept');
      setBusy(false);
    }
  };

  return (
    <main className="auth-wrap">
      <div className="card auth-card">
        <h1>Join the team</h1>
        {error ? (
          <>
            <div className="error-note">{error}</div>
            <Link className="btn block" to="/">Back to the map</Link>
          </>
        ) : !info ? (
          <p className="muted">Loading invitation…</p>
        ) : (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              You've been invited to <b>{info.storeName}</b> as <b>{info.role}</b>
              {info.role === 'stock' && ' — adjust stock and edit products'}
              {info.role === 'manager' && ' — edit maps, catalog and settings'}
              {info.role === 'viewer' && ' — view-only access'}
              .
            </p>
            {loading ? (
              <p className="muted">…</p>
            ) : user ? (
              <>
                {user.email?.toLowerCase() !== info.email.toLowerCase() && (
                  <div className="warn-note">
                    This invitation was sent to <b>{info.email}</b> — you're signed in as {user.email}.
                    Sign in with the invited account to accept.
                  </div>
                )}
                <button className="btn primary block" disabled={busy || user.email?.toLowerCase() !== info.email.toLowerCase()} onClick={accept}>
                  {busy ? 'Joining…' : 'Accept invitation'}
                </button>
                <button className="btn block" onClick={async () => { await api.logout(); await refresh(); }}>Sign in as {info.email}</button>
              </>
            ) : (
              <>
                <Link className="btn primary block" to={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}>
                  Sign in to accept ({info.email})
                </Link>
              </>
            )}
          </>
        )}
      </div>
    </main>
  );
}
