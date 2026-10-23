/** バトルの進行元（CPU戦ローカル / オンライン）を共通インターフェースで扱う */
import { CpuBrain, Difficulty, EndReason, FighterInput, FighterStats, Match, MatchEvent, MaterialId, Poly } from '@kinggnu/shared';
import { MatchView, viewFromMatch } from '../render/view';

export interface BattleResult {
  winner: 0 | 1 | null;
  reason: EndReason;
  time: number;
  stats: [FighterStats, FighterStats];
  you: 0 | 1;
  names: [string, string];
  materials: [MaterialId, MaterialId];
}

export interface BattleSource {
  readonly you: 0 | 1;
  readonly labels: [string, string];
  update(dt: number): void;
  view(): MatchView | null;
  drainEvents(): MatchEvent[];
  setInput(input: FighterInput): void;
  result(): BattleResult | null;
  /** 入力予測による自分のチャージ量（オンライン用） */
  localCharge?(): number | undefined;
  dispose(): void;
}

export interface LocalSetup {
  player: { polygon: Poly; material: MaterialId; name: string };
  cpu: { polygon: Poly; material: MaterialId; name: string };
  difficulty: Difficulty;
}

export class LocalSource implements BattleSource {
  readonly you = 0 as const;
  readonly labels: [string, string];
  match: Match;
  brain: CpuBrain;

  constructor(public setup: LocalSetup) {
    this.match = new Match(
      { polygon: setup.player.polygon, material: setup.player.material, name: setup.player.name },
      { polygon: setup.cpu.polygon, material: setup.cpu.material, name: setup.cpu.name },
    );
    this.brain = new CpuBrain(setup.difficulty, (Math.random() * 1e9) | 0);
    this.labels = [setup.player.name, setup.cpu.name];
  }

  update(dt: number) {
    // CPU の思考は固定刻みで行い、物理は Match 内部の固定タイムステップで進む
    const ai = this.brain.update(this.match, 1, dt * this.match.timeScale);
    this.match.setInput(1, ai);
    this.match.update(dt);
  }

  view() {
    return viewFromMatch(this.match);
  }

  drainEvents() {
    return this.match.drainEvents();
  }

  setInput(input: FighterInput) {
    this.match.setInput(0, input);
  }

  result(): BattleResult | null {
    if (this.match.state !== 'over' || !this.match.result) return null;
    const [a, b] = this.match.fighters;
    return {
      ...this.match.result,
      stats: [a.stats, b.stats],
      you: 0,
      names: this.labels,
      materials: [a.material, b.material],
    };
  }

  dispose() {}
}
