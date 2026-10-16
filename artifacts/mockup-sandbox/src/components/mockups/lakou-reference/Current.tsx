import './_group.css';

const tables = [['Jean', 'Points', '3/4'], ['Nadège', 'Regular', '2/4'], ['Marc', 'Points', '1/4'], ['Ti Jo', 'Regular', '3/4']];
const scores = [['Ti Jo', '58'], ['Nadège', '53'], ['Marc', '50'], ['Stéphanie', '43'], ['Venloud', '37'], ['Jean', '35']];

export function Current() {
  return (
    <main className="lakou-extract">
      <header className="extract-topbar"><strong className="extract-brand">Lakou Domino</strong><div className="extract-actions"><button type="button">Sign in</button><button type="button">Sign up</button></div></header>
      <div className="extract-stripe"><i /><i /><i /><i /><i /><i /><i /></div>
      <p className="extract-presence"><b>● 128 players online</b>　·　34 tables playing</p>
      <section className="extract-grid">
        <aside className="extract-panel"><p className="extract-label">Leaderboard <span style={{ float: 'right', color: '#ffb51e' }}>View all</span></p>{scores.map(([name, score], index) => <div className="extract-row" key={name}><span className="extract-rank">{index + 1}</span><span>{name}</span><b className="extract-score">{score}</b></div>)}</aside>
        <section className="extract-main"><h1>Live lobby</h1><p>● Connected</p><div className="extract-tables"><div className="extract-table" style={{ color: '#81788b' }}><span>OPEN TABLES</span><span>Mode</span><span>Seats</span><span /></div>{tables.map(([name, mode, seats]) => <div className="extract-table" key={name}><strong>{name}&apos;s table</strong><span>{mode}</span><span>{seats}</span><button type="button">Join</button></div>)}</div><form className="extract-form"><label>Your name</label><input placeholder="e.g. Jean" /><label>Mode</label><select defaultValue="Points"><option>Regular</option><option>Points</option></select><label>Row length (Points only)</label><input value="10 boxes" readOnly /><label>Turn timer</label><select defaultValue="30 seconds"><option>30 seconds</option></select><button type="button">Open table</button></form><form className="extract-join"><input placeholder="Enter table code" /><button type="button">Join</button></form></section>
        <aside className="extract-quick"><p className="extract-label">Quick play</p><button type="button" className="extract-quick-card"><strong>▦ Play with friends</strong><small>Invite with a link or code</small></button><button type="button" className="extract-quick-card"><strong>▦ Practice vs bots</strong><small>Easy or Hard, start instantly</small></button><button type="button" className="extract-quick-card"><strong>▦ How to play</strong><small>Regular and Points rules</small></button></aside>
      </section>
    </main>
  );
}