import { useState } from 'react';
import { MaterialId, ONLINE_BANNED, processOutline, templateStrokes } from '@kinggnu/shared';
import { BattleResult, LocalSource } from './game/source';
import { Battle } from './screens/Battle';
import { CpuChoice, CpuSetup, resolveCpu } from './screens/CpuSetup';
import { HornDraft, HornEditor } from './screens/HornEditor';
import { MaterialSelect } from './screens/MaterialSelect';
import { Online } from './screens/Online';
import { Result } from './screens/Result';
import { Title } from './screens/Title';

type Screen = 'title' | 'editor' | 'material' | 'cpu' | 'battle' | 'result' | 'online';
type Mode = 'cpu' | 'online';

const initialStrokes = templateStrokes('classic');
const initialDraft: HornDraft = {
  name: 'My Horn',
  strokes: initialStrokes,
  polygon: processOutline(initialStrokes).polygon,
  material: 'plastic',
};

export function App() {
  const [screen, setScreen] = useState<Screen>('title');
  const [mode, setMode] = useState<Mode>('cpu');
  const [draft, setDraft] = useState<HornDraft>(initialDraft);
  const [cpu, setCpu] = useState<CpuChoice>({ difficulty: 'normal', material: 'random', template: 'random' });
  const [source, setSource] = useState<LocalSource | null>(null);
  const [result, setResult] = useState<BattleResult | null>(null);
  const [cpuLabel, setCpuLabel] = useState('CPU');

  const startCpu = (c: CpuChoice, resolved = resolveCpu(c)) => {
    const label = `CPU ${c.difficulty.toUpperCase()}`;
    setCpuLabel(label);
    source?.dispose();
    setSource(
      new LocalSource({
        player: { polygon: draft.polygon, material: draft.material, name: draft.name || 'YOU' },
        cpu: { polygon: resolved.polygon, material: resolved.material, name: `${label}（${resolved.templateName}）` },
        difficulty: c.difficulty,
      }),
    );
    setScreen('battle');
  };

  switch (screen) {
    case 'title':
      return (
        <Title
          onCpu={() => {
            setMode('cpu');
            setScreen('editor');
          }}
          onOnline={() => {
            setMode('online');
            setScreen('editor');
          }}
        />
      );
    case 'editor':
      return (
        <HornEditor
          initial={draft}
          onBack={() => setScreen('title')}
          onDone={(d) => {
            setDraft(d);
            setScreen('material');
          }}
        />
      );
    case 'material':
      return (
        <MaterialSelect
          polygon={draft.polygon}
          initial={draft.material}
          nextLabel={mode === 'cpu' ? '決定 → CPU設定' : '決定 → オンラインへ'}
          disabled={mode === 'online' ? ONLINE_BANNED : []}
          disabledLabel="オンライン禁止"
          onBack={() => setScreen('editor')}
          onDone={(m: MaterialId) => {
            setDraft({ ...draft, material: m });
            setScreen(mode === 'cpu' ? 'cpu' : 'online');
          }}
        />
      );
    case 'cpu':
      return (
        <CpuSetup
          initial={cpu}
          onBack={() => setScreen('material')}
          onStart={(c, r) => {
            setCpu(c);
            startCpu(c, r);
          }}
        />
      );
    case 'battle':
      return source ? (
        <Battle
          source={source}
          onQuit={() => setScreen('cpu')}
          onEnd={(r) => {
            setResult(r);
            setScreen('result');
          }}
        />
      ) : null;
    case 'result':
      return result ? (
        <Result
          result={result}
          note={`対戦相手: ${cpuLabel}`}
          actions={[
            { label: 'リトライ（同じ相手）', primary: true, onClick: () => source && startCpu(cpu, { polygon: source.setup.cpu.polygon, material: source.setup.cpu.material, templateName: source.setup.cpu.name.replace(/^.*（|）$/g, '') }) },
            { label: '別の相手と戦う', onClick: () => startCpu(cpu) },
            { label: '角を作り直す', onClick: () => setScreen('editor') },
            { label: 'タイトルへ', onClick: () => setScreen('title') },
          ]}
        />
      ) : null;
    case 'online':
      return (
        <Online
          horn={{ name: draft.name, polygon: draft.polygon, material: draft.material }}
          onBack={() => setScreen('title')}
          onEditHorn={() => setScreen('editor')}
        />
      );
  }
}
