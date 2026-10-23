/**
 * オンライン対戦の進行元。
 * クライアントは試合を勝手に進めない（サーバー権威）。届いたスナップショットを
 * 少し遅らせて補間表示し、自分のチャージゲージだけ入力から即時予測して表示する。
 */
import {
  CONTROL,
  MATCH,
  CrackMark,
  FighterInput,
  FighterSnap,
  HornModel,
  MatchEvent,
  MatchSnapshot,
  PublicPlayer,
  ServerMsg,
  buildHornModel,
} from '@kinggnu/shared';
import { BattleResult, BattleSource } from '../game/source';
import { FighterView, MatchView, phaseFromCode } from '../render/view';
import { NetClient } from './client';

const INTERP_DELAY = 110;

interface Buffered {
  at: number;
  snap: MatchSnapshot;
}

interface HornState {
  rev: number;
  model: HornModel;
  cracks: CrackMark[];
}

export class OnlineSource implements BattleSource {
  readonly you: 0 | 1;
  readonly labels: [string, string];
  private buf: Buffered[] = [];
  private events: { at: number; e: MatchEvent }[] = [];
  private horns: [HornState[], HornState[]];
  private input: FighterInput = { charge: false, move: 0 };
  private seq = 0;
  private lastSent = 0;
  private chargeStart = 0;
  private res: BattleResult | null = null;
  private off: () => void;
  ended = false;
  players: PublicPlayer[];

  constructor(public client: NetClient, start: { you: 0 | 1; players: PublicPlayer[] }) {
    this.you = start.you;
    this.players = start.players;
    this.labels = [start.players[0].name, start.players[1].name];
    this.horns = [
      [{ rev: 0, model: buildHornModel(start.players[0].polygon), cracks: [] }],
      [{ rev: 0, model: buildHornModel(start.players[1].polygon), cracks: [] }],
    ];
    this.off = client.on((m) => this.onMsg(m));
  }

  private onMsg(m: ServerMsg) {
    const now = performance.now();
    if (m.t === 's') {
      this.buf.push({ at: now, snap: m.snap });
      if (this.buf.length > 60) this.buf.splice(0, this.buf.length - 60);
      for (const e of m.ev) this.events.push({ at: now, e });
    } else if (m.t === 'horn') {
      const list = this.horns[m.f];
      const prev = list[list.length - 1];
      const samePoly = prev && JSON.stringify(prev.model.polygon) === JSON.stringify(m.shape.polygon);
      const model = samePoly ? prev.model : buildHornModel(m.shape.polygon);
      const cracks: CrackMark[] = m.shape.cracks.map((c) => ({ b: { s: c[0], t: c[1], a: c[2], d: c[3] }, len: c[4], ang: c[5], seed: c[6] }));
      list.push({ rev: m.shape.rev, model, cracks });
      if (list.length > 20) list.splice(0, list.length - 20);
    } else if (m.t === 'end') {
      this.ended = true;
      this.res = {
        winner: m.winner,
        reason: m.reason,
        time: m.time,
        stats: [m.stats[0], m.stats[1]],
        you: this.you,
        names: this.labels,
        materials: [this.players[0].material, this.players[1].material],
      };
    }
  }

  update(_dt: number) {
    const now = performance.now();
    // 入力の定期送信（変化がなくても 150ms ごと）
    if (now - this.lastSent > 150) this.sendInput();
  }

  private sendInput() {
    this.lastSent = performance.now();
    this.client.send({ t: 'in', seq: this.seq++, c: this.input.charge, m: this.input.move });
  }

  setInput(input: FighterInput) {
    const changed = input.charge !== this.input.charge || input.move !== this.input.move;
    if (input.charge && !this.input.charge) this.chargeStart = performance.now();
    this.input = { ...input };
    if (changed) this.sendInput();
  }

  localCharge() {
    if (!this.input.charge) return undefined;
    const v = this.view();
    const me = v?.fighters[this.you];
    if (!me || (me.phase !== 'idle' && me.phase !== 'charge')) return undefined;
    // サーバー側のチャージ量より先行して表示（遅延を隠す）
    const local = Math.min(1, (performance.now() - this.chargeStart) / 1000 / CONTROL.chargeTime);
    return Math.max(me.charge, local);
  }

  drainEvents(): MatchEvent[] {
    const cut = performance.now() - INTERP_DELAY;
    const out: MatchEvent[] = [];
    while (this.events.length && this.events[0].at <= cut) out.push(this.events.shift()!.e);
    return out;
  }

  private hornFor(i: 0 | 1, rev: number): HornState {
    const list = this.horns[i];
    for (let k = list.length - 1; k >= 0; k--) if (list[k].rev <= rev) return list[k];
    return list[0];
  }

  view(): MatchView | null {
    if (!this.buf.length) return null;
    const t = performance.now() - INTERP_DELAY;
    let a = this.buf[0];
    let b = this.buf[0];
    for (let k = 0; k < this.buf.length; k++) {
      if (this.buf[k].at <= t) a = this.buf[k];
      if (this.buf[k].at >= t) {
        b = this.buf[k];
        break;
      }
      b = this.buf[k];
    }
    const span = b.at - a.at;
    const u = span > 0 ? Math.max(0, Math.min(1, (t - a.at) / span)) : 1;
    const sa = a.snap;
    const sb = b.snap;
    const fighters = [0, 1].map((i) => this.fighterView(i as 0 | 1, sa.f[i], sb.f[i], u)) as [FighterView, FighterView];
    return {
      state: sb.st,
      countdown: sa.cd + (sb.cd - sa.cd) * u,
      time: sa.time + (sb.time - sa.time) * u,
      timeLeft: Math.max(0, MATCH.duration - (sa.time + (sb.time - sa.time) * u)),
      timeScale: sb.ts,
      fighters,
    };
  }

  private fighterView(i: 0 | 1, a: FighterSnap, b: FighterSnap, u: number): FighterView {
    const lerp = (x: number, y: number) => x + (y - x) * u;
    const hs = this.hornFor(i, b[10]);
    const na = a[16];
    const nb = b[16];
    const sameShape = a[10] === b[10] && na.length === nb.length;
    const n = nb.length / 2;
    const nx = new Float64Array(n);
    const ny = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      nx[k] = sameShape ? lerp(na[k * 2], nb[k * 2]) : nb[k * 2];
      ny[k] = sameShape ? lerp(na[k * 2 + 1], nb[k * 2 + 1]) : nb[k * 2 + 1];
    }
    const p = this.players[i];
    const nodeCount = hs.model.nodes.length;
    return {
      idx: i,
      facing: i === 0 ? 1 : -1,
      name: p.name,
      material: p.material,
      x: lerp(a[0], b[0]),
      theta: lerp(a[1], b[1]),
      phase: phaseFromCode(b[2]),
      charge: lerp(a[3], b[3]),
      hp: b[4],
      maxHp: b[5],
      baseMaxHp: p.maxHp,
      guard: b[6] === 1,
      stun: b[7],
      melt: lerp(a[8], b[8]),
      widthScale: lerp(a[9], b[9]),
      stress: b[11],
      crackLevel: b[12],
      destroyed: b[13] === 1,
      vx: b[14],
      flash: b[15],
      model: nodeCount === n ? hs.model : this.hornFor(i, a[10]).model,
      nodesX: nx,
      nodesY: ny,
      cracks: hs.cracks,
    };
  }

  result() {
    return this.res;
  }

  dispose() {
    this.off();
  }
}
