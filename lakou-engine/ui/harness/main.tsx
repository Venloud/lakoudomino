// Local harness: runs the real engine with bots and feeds <LakouGame>. Used for checking against Figma
// and as a playable practice table. URL options: ?state=mid|pick|reveal|standings|final|offer  ?pace=0.2  ?seed=7
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  applyAction, autoStep, createMatch, nextStep, legalActions, startNextHand, timeoutMove, viewFor, botMove,
  type Action, type GameEvent, type MatchState,
} from '../../src/index';
import { LakouGame, type ChatMessage } from '../index';
import '../lakou-ui.css';
import { Screens } from './screens';

const params = new URLSearchParams(location.search);
const STATE = params.get('state') || '';
const PACE = Number(params.get('pace') || 1);
const SEED = Number(params.get('seed') || 11);
const MODE = (params.get('mode') === 'regular' ? 'regular' : 'points') as 'regular' | 'points';
const NAMES = ['Venloud', 'Jean', 'Nadège', 'Bot 3'];
const AFTER_PLAY_MS = 5000;
const TURN_MS = 30000;
const SEATS: ('human' | 'hard')[] = ['human', 'hard', 'hard', 'hard'];

function fastForward(m: MatchState, stopWhen: (m: MatchState) => boolean): { m: MatchState; events: GameEvent[] } {
  let events: GameEvent[] = [];
  let guard = 0;
  let rnd = SEED;
  const random = () => { rnd = (rnd * 16807) % 2147483647; return rnd / 2147483647; };
  while (!stopWhen(m) && guard++ < 500) {
    if (m.over) break;
    if (m.hand.over) { m = startNextHand(m).match; continue; }
    const r = applyAction(m, botMove(m, 'hard', random));
    m = r.match; events = r.events;
  }
  return { m, events };
}

function initial(): { m: MatchState; events: GameEvent[] } {
  const m = createMatch({ mode: MODE, playerCount: 4, rowBoxes: 10, seed: SEED }).match;
  if (STATE === 'mid' || STATE === 'pick' || STATE === 'offer') {
    const target = STATE === 'pick' ? 5 : 6;
    return fastForward(m, (x) => x.hand.board.history.length >= target && x.hand.turn === 0 && legalActions(x).some((a) => a.type === 'play'));
  }
  if (STATE === 'reveal' || STATE === 'standings') return fastForward(m, (x) => x.hand.over && x.scores.some((s) => s > 0));
  if (STATE === 'final') return fastForward(m, (x) => x.over);
  return { m, events: [] };
}

const SEED_CHAT: ChatMessage[] = [
  { id: 1, seat: 2, name: 'Nadège', text: 'that 5-5 was cold' },
  { id: 2, seat: 1, name: 'Jean', text: 'PASS! lol' },
  { id: 3, seat: 3, name: 'Bot 3', text: 'Nice one.' },
  { id: 4, seat: 0, name: 'Venloud', text: 'watch this 4-1', mine: true },
];

function App() {
  const first = useRef(initial());
  const [match, setMatch] = useState<MatchState>(first.current.m);
  const [events, setEvents] = useState<GameEvent[]>(first.current.events);
  const [eventsKey, setEventsKey] = useState(1);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [chat, setChat] = useState<ChatMessage[]>(SEED_CHAT);
  const [notify, setNotify] = useState(true);
  const [offer, setOffer] = useState(STATE === 'offer');
  const timer = useRef<number>();

  const push = (r: { match: MatchState; events: GameEvent[] }) => {
    setMatch(r.match); setEvents(r.events); setEventsKey((k) => k + 1);
  };

  // Server-style pacing: 5 s after every play, then bots act or the human gets 30 s.
  useEffect(() => {
    clearTimeout(timer.current);
    setDeadline(null);
    if (match.over || match.hand.over || STATE === 'pick' || STATE === 'mid') {
      if ((STATE === 'pick' || STATE === 'mid') && match.hand.turn === 0) setDeadline(Date.now() + 18000);
      return;
    }
    const step = nextStep(match, SEATS, events, { speed: PACE });
    if (step.type === 'none') return;
    timer.current = window.setTimeout(() => {
      if (step.type === 'human') {
        setDeadline(Date.now() + step.turnMs);
        timer.current = window.setTimeout(() => push(timeoutMove(match)), step.turnMs);
        return;
      }
      const r = autoStep(match, SEATS);
      if (r) push(r);
    }, step.delayMs);
    return () => clearTimeout(timer.current);
  }, [match]);

  const onAction = (a: Action) => {
    try { push(applyAction(match, a)); } catch (e) { console.warn(e); }
  };

  return (
    <LakouGame
      view={viewFor(match, 0)}
      names={NAMES}
      tableCode="XU62"
      events={events}
      eventsKey={eventsKey}
      turnDeadline={deadline}
      turnMs={TURN_MS}
      chat={chat}
      onAction={onAction}
      onSendChat={(text) => setChat((c) => [...c, { id: Date.now(), seat: 0, name: 'Venloud', text, mine: true }])}
      onNextHand={() => push(startNextHand(match))}
      canStartNextHand
      onPlayAgain={() => push(createMatch({ mode: MODE, playerCount: 4, rowBoxes: 10 }))}
      onLeave={() => {}}
      waitlist={{
        entries: [{ id: 'm', name: 'Marc' }, { id: 'k', name: 'Kenny' }, { id: 't', name: 'Tasha' }],
        meId: null, notify, onToggleNotify: setNotify,
      }}
      seatOffer={offer ? {
        tableName: 'Venloud’s table', seatNumber: 4, reason: 'Jean got up after the last game and you’re next in line.',
        expiresAt: Date.now() + 48000, onTake: () => setOffer(false), onStay: () => setOffer(false),
      } : null}
    />
  );
}

const SCREEN = params.get('screen');
createRoot(document.getElementById('root')!).render(SCREEN ? <Screens screen={SCREEN} /> : <App />);
