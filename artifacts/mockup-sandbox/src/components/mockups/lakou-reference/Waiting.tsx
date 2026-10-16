import './_group.css';

export function Waiting() {
  return (
    <main className="lakou-extract">
      <header className="extract-topbar"><strong className="extract-brand">Lakou Domino</strong><span style={{ color: '#a49ba9', fontSize: 10 }}>Venloud　XU62</span></header>
      <div className="extract-stripe"><i /><i /><i /><i /><i /><i /><i /></div>
      <section className="extract-grid" style={{ paddingTop: 34 }}>
        <section className="extract-main" style={{ gridColumn: '1 / 3' }}><p className="extract-label">Waiting room</p><h1>Venloud&apos;s table</h1><p><b>● 2 of 4 seats filled</b>　·　waiting for players</p><div style={{ padding: 14, background: '#24202d', borderRadius: 7 }}><span className="extract-label">Table code</span><strong style={{ display: 'block', color: '#ffb51e', fontSize: 27, letterSpacing: '.18em' }}>XU62</strong><small style={{ color: '#958b9b' }}>lakoudomino.com/t/XU62</small></div><div className="extract-table" style={{ marginTop: 18 }}><strong>Venloud</strong><span>Host</span><span> </span><button type="button">Joined</button></div><div className="extract-table"><strong>Jean</strong><span>Joined</span><span> </span><button type="button">Ready</button></div><div className="extract-table"><strong>Open seat</strong><span>Invite</span><span> </span><button type="button">+</button></div></section><aside className="extract-panel"><p className="extract-label">Invite friends</p><div className="extract-row"><span>●</span><span>Jean<br /><small>At this table</small></span><b>Joined</b></div><div className="extract-row"><span>●</span><span>Marc<br /><small>Online</small></span><b>Invite</b></div><p className="extract-label" style={{ marginTop: 24 }}>Table chat</p><p style={{ color: '#9b91a3', fontSize: 10 }}>Jean<br /><span style={{ color: '#f2eee4' }}>Yo I&apos;m here</span></p></aside>
      </section>
    </main>
  );
}