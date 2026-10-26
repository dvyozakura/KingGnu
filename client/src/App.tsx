import { useEffect, useState } from 'react';
import { MaterialId, ONLINE_BANNED, SKIN_IDS, processOutline, templateStrokes } from '@kinggnu/shared';
import { afterMatchAd } from './account/ads';
import { account, useAccount } from './account/session';
import { LoginBonus } from './components/AccountOverlays';
import { Shop } from './screens/Shop';
import { Skins } from './screens/Skins';
import { BattleResult, LocalSource } from './game/source';
import { Battle } from './screens/Battle';
import { CpuChoice, CpuSetup, resolveCpu } from './screens/CpuSetup';
import { HornDraft, HornEditor } from './screens/HornEditor';
import { MaterialSelect } from './screens/MaterialSelect';
import { Online } from './screens/Online';
import { Result } from './screens/Result';
import { Title } from './screens/Title';

type Screen = 'title' | 'editor' | 'material' | 'cpu' | 'battle' | 'result' | 'online' | 'shop' | 'skins';
type Mode = 'cpu' | 'online';

const initialStrokes = templateStrokes('classic');
const initialDraft: HornDraft = {
  name: 'My Horn',
  strokes: initialStrokes,
  polygon: processOutline(initialStrokes).polygon,
  material: 'plastic',
};

export function App() {
  return (
    <>
      <Screens />
      <LoginBonus />
    </>
  );
}

function Screens() {
  const [screen, setScreenRaw] = useState<Screen>('title');
  const [back, setBack] = useState<Screen>('title');
  const { profile } = useAccount();
  useEffect(() => account.start(), []);
  const setScreen = (s: Screen) => {
    if (s === 'shop' || s === 'skins') setBack((b) => (screen === 'shop' || screen === 'skins' ? b : screen));
    setScreenRaw(s);
  };
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
        player: { polygon: draft.polygon, material: draft.material, name: draft.name || 'YOU', skin: profile?.skin },
        cpu: { polygon: resolved.polygon, material: resolved.material, name: `${label}（${resolved.templateName}）`, skin: SKIN_IDS[Math.floor(Math.random() * SKIN_IDS.length)] },
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
          onShop={() => setScreen('shop')}
          onSkins={() => setScreen('skins')}
        />
      );
    case 'editor':
      return (
        <HornEditor
          initial={draft}
          onBack={() => setScreen('title')}
          onShop={() => setScreen('shop')}
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
          onShop={() => setScreen('shop')}
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
            void afterMatchAd();
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
    case 'shop':
      return <Shop onBack={() => setScreen(back)} onSkins={() => setScreen('skins')} />;
    case 'skins':
      return <Skins onBack={() => setScreen(back)} onShop={() => setScreen('shop')} />;
  }
}
