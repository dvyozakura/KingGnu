/** ONLINE BATTLE：ニックネーム → QUICK MATCH / CREATE ROOM / JOIN ROOM → 準備完了 → 対戦 → 再戦 */
import { useEffect, useRef, useState } from 'react';
import {
  MATERIALS,
  MaterialId,
  PROTOCOL_VERSION,
  Poly,
  PublicPlayer,
  ROOM_CODE_LENGTH,
  ServerMsg,
  isValidRoomCode,
  makeHornData,
  normalizeRoomCode,
} from '@kinggnu/shared';
import { HornPreview } from '../components/HornPreview';
import { sfx, unlockAudio } from '../game/audio';
import { BattleResult } from '../game/source';
import { loadNickname, saveNickname } from '../game/storage';
import { DEFAULT_SERVER_URL, NetClient, defaultServerUrl, saveServerUrl } from '../net/client';
import { OnlineSource } from '../net/onlineSource';
import { Battle } from './Battle';
import { Result } from './Result';

interface Props {
  horn: { name: string; polygon: Poly; material: MaterialId };
  onBack: () => void;
  onEditHorn: () => void;
}

type Phase = 'menu' | 'connecting' | 'queue' | 'room' | 'battle' | 'result';

interface RoomInfo {
  code: string;
  you: 0 | 1;
  players: (PublicPlayer | null)[];
  quick: boolean;
}

const ERRORS: Record<string, string> = {
  room_not_found: 'そのルームは見つかりません',
  room_full: 'ルームが満員です',
  bad_code: 'ルームコードの形式が正しくありません',
  rate_limited: '操作が速すぎます。少し待ってください',
  too_many_attempts: '失敗が続いたため一時的に制限されています',
  not_in_room: 'ルームに入っていません',
  server_full: 'サーバーが混雑しています',
  invalid_horn: '角データが不正です',
  banned_material: 'この材質は現在オンライン対戦で使用禁止です。材質を選び直してください',
  version: 'クライアントのバージョンが古いです。再読み込みしてください',
  no_hello: 'もう一度ボタンを押してください',
  already_in_room: 'すでにルームに入っています',
};

export function Online({ horn, onBack, onEditHorn }: Props) {
  const [name, setName] = useState(loadNickname());
  const [url, setUrl] = useState(defaultServerUrl());
  const [showAdv, setShowAdv] = useState(false);
  const [code, setCode] = useState('');
  const [phase, setPhase] = useState<Phase>('menu');
  const [error, setError] = useState('');
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [ready, setReady] = useState(false);
  const [source, setSource] = useState<OnlineSource | null>(null);
  const [result, setResult] = useState<BattleResult | null>(null);
  const [votes, setVotes] = useState<[boolean, boolean]>([false, false]);
  const [banner, setBanner] = useState('');
  const [warn, setWarn] = useState<string[]>([]);
  const [rtt, setRtt] = useState(0);
  const clientRef = useRef<NetClient | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const id = setInterval(() => setRtt(Math.round(clientRef.current?.rtt ?? 0)), 1000);
    return () => {
      clearInterval(id);
      clientRef.current?.send({ t: 'leave' });
      clientRef.current?.close();
      clientRef.current = null;
    };
  }, []);

  const handle = (m: ServerMsg) => {
    switch (m.t) {
      case 'err':
        if (m.code === 'resume_failed') {
          // サーバー再起動などで部屋が消えた
          setError('サーバーが再起動したため、ロビーに戻りました');
          setRoom(null);
          setPhase('menu');
          break;
        }
        if (m.code === 'no_hello') break; // 自動で名乗り直すので表示しない
        setError(ERRORS[m.code] ?? m.msg ?? m.code);
        if (phaseRef.current === 'connecting' || phaseRef.current === 'queue') setPhase('menu');
        break;
      case 'queued':
        setPhase('queue');
        break;
      case 'room':
        setRoom({ code: m.code, you: m.you, players: m.players, quick: m.quick });
        if (phaseRef.current !== 'battle' && phaseRef.current !== 'result') setPhase('room');
        if (m.state === 'lobby') setReady(!!m.players[m.you]?.ready);
        break;
      case 'start': {
        const cl = clientRef.current!;
        setSource((old) => {
          old?.dispose();
          return new OnlineSource(cl, { you: m.you, players: m.players });
        });
        setVotes([false, false]);
        setBanner('');
        setResult(null);
        setPhase('battle');
        break;
      }
      case 'rematch':
        setVotes(m.votes);
        break;
      case 'opp':
        if (m.status === 'disconnected') setBanner('相手の接続が切れました。再接続を待っています…');
        else if (m.status === 'reconnected') setBanner('');
        else {
          setBanner('');
          setError('相手が退出しました');
          if (phaseRef.current === 'room') setReady(false);
        }
        break;
      case 'left':
        setRoom(null);
        setPhase('menu');
        break;
    }
  };

  const ensureClient = async (): Promise<NetClient> => {
    const existing = clientRef.current;
    const reuse = existing && existing.status === 'open';
    const cl = reuse ? existing : new NetClient(url || DEFAULT_SERVER_URL);
    if (!reuse) {
      clientRef.current = cl;
      cl.on(handle);
      cl.onStatus((s) => {
        if (s === 'reconnecting') setBanner('通信が切れました。再接続中…');
        else if (s === 'open') setBanner((b) => (b.startsWith('通信') ? '' : b));
        else if (s === 'closed' && phaseRef.current !== 'menu') {
          setBanner('');
          setError('サーバーとの接続が切れました');
          setPhase('menu');
        }
      });
      await cl.connect();
    }
    // 毎回名乗り直す（サーバー再起動などで名乗りが失われていても確実に通るように）
    const welcome = new Promise<void>((resolve, reject) => {
      const off = cl.on((m) => {
        if (m.t === 'welcome') {
          off();
          setWarn(m.horn.warnings);
          resolve();
        } else if (m.t === 'err') {
          off();
          reject(new Error(ERRORS[m.code] ?? m.msg));
        }
      });
      setTimeout(() => reject(new Error('サーバーから応答がありません')), 6000);
    });
    cl.sendHello({
      t: 'hello',
      v: PROTOCOL_VERSION,
      name: name.trim() || 'Guest',
      horn: makeHornData(horn.name, horn.material, horn.polygon),
    });
    await welcome;
    cl.resumable = true;
    return cl;
  };

  const act = async (msg: 'quick' | 'create' | 'join') => {
    unlockAudio();
    sfx.click();
    setError('');
    if (!name.trim()) {
      setError('ニックネームを入力してください');
      return;
    }
    if (msg === 'join' && !isValidRoomCode(code)) {
      setError(`ルームコードは${ROOM_CODE_LENGTH}文字です`);
      return;
    }
    saveNickname(name.trim());
    saveServerUrl(url);
    setPhase('connecting');
    try {
      const cl = await ensureClient();
      if (msg === 'join') cl.send({ t: 'join', code });
      else cl.send({ t: msg });
    } catch (e) {
      setError(`接続できませんでした：${(e as Error).message}`);
      setPhase('menu');
      clientRef.current?.close();
      clientRef.current = null;
    }
  };

  const leaveRoom = () => {
    clientRef.current?.send({ t: 'leave' });
    setRoom(null);
    setReady(false);
    setPhase('menu');
  };

  if (phase === 'battle' && source) {
    return (
      <Battle
        source={source}
        banner={banner}
        onEnd={(r) => {
          setResult(r);
          setPhase('result');
        }}
        onQuit={leaveRoom}
      />
    );
  }

  if (phase === 'result' && result && room) {
    const you = result.you;
    const oppGone = !room.players[1 - you] || error === '相手が退出しました';
    return (
      <Result
        result={result}
        note={
          oppGone
            ? '相手が退出しました'
            : votes[1 - you]
              ? '相手が再戦を希望しています！'
              : votes[you]
                ? '相手の返事を待っています…'
                : undefined
        }
        actions={[
          {
            label: votes[you] ? '再戦を申請中…' : '再戦を申請する',
            primary: true,
            disabled: votes[you] || oppGone,
            onClick: () => clientRef.current?.send({ t: 'rematch' }),
          },
          { label: 'ロビーに戻る', onClick: leaveRoom },
          { label: 'タイトルへ', onClick: onBack },
        ]}
      />
    );
  }

  const me = horn;
  return (
    <div className="screen online">
      <header className="bar">
        <button className="ghost" onClick={phase === 'room' || phase === 'queue' ? leaveRoom : onBack}>
          ← {phase === 'room' || phase === 'queue' ? '退出' : 'タイトル'}
        </button>
        <h2>ONLINE BATTLE</h2>
        <span className="muted">{rtt ? `ping ${rtt}ms` : ''}</span>
      </header>
      <div className="online-body">
        <div className={`panel my-horn ${phase === 'room' ? 'hide-mobile' : ''}`}>
          <h4>あなたの角</h4>
          <HornPreview polygon={me.polygon} material={me.material} width={220} height={150} />
          <div>
            {me.name}（{MATERIALS[me.material].name}）
          </div>
          {phase === 'menu' && (
            <button className="small" onClick={onEditHorn}>
              角・材質を変更
            </button>
          )}
          {warn.length > 0 && <p className="hint">{warn.join(' ')}</p>}
        </div>

        {(phase === 'menu' || phase === 'connecting') && (
          <div className="panel menu">
            <label>
              ニックネーム
              <input value={name} maxLength={16} onChange={(e) => setName(e.target.value)} placeholder="なまえ（16文字まで）" />
            </label>
            <button className="primary big" disabled={phase === 'connecting'} onClick={() => act('quick')}>
              QUICK MATCH <small>ランダム対戦</small>
            </button>
            <button className="big" disabled={phase === 'connecting'} onClick={() => act('create')}>
              CREATE ROOM <small>友達と対戦</small>
            </button>
            <div className="join-row">
              <input
                className="code-input"
                value={code}
                onChange={(e) => setCode(normalizeRoomCode(e.target.value))}
                placeholder="ルームコード"
                maxLength={ROOM_CODE_LENGTH}
              />
              <button disabled={phase === 'connecting'} onClick={() => act('join')}>
                JOIN ROOM
              </button>
            </div>
            {phase === 'connecting' && <p className="hint">接続中…</p>}
            <button className="link" onClick={() => setShowAdv((v) => !v)}>
              接続先サーバー {showAdv ? '▲' : '▼'}
            </button>
            {showAdv && (
              <label>
                WebSocket URL
                <input value={url} onChange={(e) => setUrl(e.target.value.trim())} placeholder="wss://your-server.example.com/ws" />
                <span className="hint">既定: {DEFAULT_SERVER_URL}（空にすると既定に戻ります）</span>
              </label>
            )}
          </div>
        )}

        {phase === 'queue' && (
          <div className="panel waiting">
            <div className="spinner" />
            <h3>対戦相手を探しています…</h3>
            <button onClick={() => clientRef.current?.send({ t: 'cancel' })}>キャンセル</button>
          </div>
        )}

        {phase === 'room' && room && (
          <div className="panel room">
            {!room.quick && (
              <div className="room-code">
                <span>ルームコード</span>
                <strong>{room.code}</strong>
                <button className="small" onClick={() => navigator.clipboard?.writeText(room.code)}>
                  コピー
                </button>
              </div>
            )}
            {room.quick && <h3>マッチング成立！</h3>}
            <div className="vs">
              {[0, 1].map((i) => {
                const p = room.players[i];
                return (
                  <div key={i} className={`slot ${i === room.you ? 'you' : ''}`}>
                    {p ? (
                      <>
                        <HornPreview polygon={p.polygon} material={p.material} fluid aspect={0.75} />
                        <div className="pname">
                          {p.name}
                          {i === room.you ? '（あなた）' : ''}
                        </div>
                        <div className="muted">
                          {MATERIALS[p.material].name} / HP {p.maxHp}
                        </div>
                        <div className={`ready ${p.ready ? 'on' : ''}`}>{p.ready ? 'READY!' : '準備中'}</div>
                      </>
                    ) : (
                      <div className="empty">
                        <div className="spinner" />
                        相手の参加を待っています
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            <button
              className="primary big ready-btn"
              disabled={!room.players[0] || !room.players[1]}
              onClick={() => {
                sfx.click();
                clientRef.current?.send({ t: 'ready', ready: !ready });
              }}
            >
              {ready ? '準備完了を取り消す' : '準備完了！'}
            </button>
            <p className="hint">両者が準備完了すると3秒のカウントダウンで開始します。</p>
          </div>
        )}
        {error && <div className="toast warn static">{error}</div>}
        {banner && <div className="toast info static">{banner}</div>}
      </div>
    </div>
  );
}
