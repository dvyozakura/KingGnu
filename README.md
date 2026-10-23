# KING GNU 🐂 — 自分で描いた角で殴り合う物理演算バトル

指やマウスで **牛の角の輪郭を自由に描き**、材質を選んで、慣性・しなり・衝突・タイミングで殴り合う 1 対 1 のブラウザゲームです。
描いた輪郭はそのまま **当たり判定・質量分布・しなり方・攻撃範囲** になり、材質ごとに硬さ・しなり・HP・反作用ダメージが変わります。

- CPU BATTLE（完全オフライン、EASY / NORMAL / HARD）
- ONLINE BATTLE（WebSocket・サーバー権威型。ランダムマッチ / ルーム作成 / ルームコード参加 / 再戦 / 切断処理）
- PC（マウス・キーボード）とスマートフォン（タッチ）の両対応

公開URL（GitHub Pages）: `https://<GitHubユーザー名>.github.io/kinggnu/`

---

## 1. ゲームの概要

| 材質 | 硬度 | しなり | 最大HP | 反作用 | 特徴 |
|---|---|---|---|---|---|
| コルク | 非常に低い | 高い | 低い | 小 | 軽量・最速・衝撃吸収。強い衝撃で欠ける。あずきに触れると溶けを速める |
| ゴム | 低い | 非常に高い | やや低い | 非常に小 | 鞭のようにしなり、先端が加速して大ダメージ。珊瑚に弱い |
| プラスチック | 中 | 中 | 中 | 中 | バランス型。強い衝撃で白化し、塑性変形する |
| 木 | やや高い | やや低い | やや高い | 中 | 安定した直接攻撃。ひび割れ、限界で折れる |
| ガラス | 非常に高い | ほぼなし | 高い | 中 | 一撃が重い。炎が効かない。ひびで脆くなり、強打で砕けて先端を失う |
| あずきのアイス | 極めて高い | ほぼゼロ | 非常に高い | 大 | 隠しボス級。ただし戦闘中ずっと溶けて細く短くなり、最後は消える（炎・コルクで加速） |
| 炎 | ほぼなし | 高い | 低い | ほぼなし | 触れるだけで接触ダメージ＋数秒の延焼（ガラスには無効）。角どうしはすり抜ける |
| 鉄 | 極めて高い | ほぼゼロ | 高い | 特大 | 溶けないあずき。壊れないが反動ダメージが全材質で最大、動きも最も遅い |
| 金 | 中 | やや低い | 高い | 小 | 重い打撃。硬い角とぶつかると曲がり、曲がったまま戦う |
| 珊瑚 | やや高い | 低い | 中 | 中 | ゴム相手にダメージ1.8倍。ひび割れ、限界で折れる |

ゲーム内のタイトル画面・材質選択画面の「📖 材質図説」で、全材質の性質・特性・相性を確認できます。

設計思想は「最強の材質を固定しない」こと。形状（長さ・太さ・曲がり・フック）との組み合わせで相性が変わります。
パラメータは `shared/src/config/materials.ts` と `shared/src/config/game.ts` に集約しています。

### 物理演算のしくみ（要点）

- **輪郭 → 物理モデル**（`shared/src/horn/`）
  非ゼロ巻き数でラスタ化して自己交差・ねじれを解消 → 頭につながらない部分を除去 → 細すぎる部分を最小太さに補強 → 最大半径・最大面積で縮小 → 外周追跡と簡略化で単純多角形（最大 64 頂点）に。
  距離場上の「中央寄り」最短経路で中心線を求めて 4〜10 個の節点を作り、各セルを節点に割り当てて質量分布・重心・慣性モーメントを計算します。
- **しなり**（`shared/src/physics/hornBody.ts`）
  Verlet + Position Based Dynamics の多節点モデル。根元 2 節点を頭に固定し、距離拘束・曲げ拘束（剛性）・形状保持（硬い材質ほど強い）・内部減衰を解きます。しなりはアニメーションではなく物理の結果です。
- **当たり判定**（`shared/src/geometry/decompose.ts`, `shared/src/sim/match.ts`）
  描いた多角形を耳切り法＋Hertel–Mehlhorn 法で凸分解し、各頂点を中心線フレームにバインド。しなった節点からスキニングした頂点で毎サブステップ SAT 判定するので、**曲がった部分・フックでもその形どおりに当たり、引っ掛かります**。
  サブステップ数は最大速度に応じて増やし（最大 10）、高速でもすり抜けません。1 回の接触は「エピソード」として扱い、重複計上しません。
- **ダメージ**（`shared/src/sim/damage.ts` に集約）
  直接衝突ダメージ＝有効質量×法線方向の接近速度×硬度×衝突角度。
  しなり攻撃ダメージ＝接触点速度のうち「頭と一体の剛体運動」で説明できない成分（＝しなり由来）の運動エネルギー×弾性。
  反作用ダメージ＝衝突インパルス×反作用倍率×相手の硬さ（硬い材質ほど大きい）。ガード・チャージ中・頭部命中で補正。
  HP は牛と角で一体ですが、角で受けた場合は軽減されたダメージが通ります（BLOCK）。

## 2. 遊び方

1. タイトルで **GAME START（CPU）** か **ONLINE BATTLE** を選ぶ
2. 角の作成画面で、頭の上の黄色い印から角の輪郭をぐるっと描く（何度でも描き足せる／一つ戻る／リセット／テンプレート）
   「当たり判定（凸分解）と節点を表示」で、実際に使われる判定と節点を確認できます
3. 材質を選ぶ（右のプレビューは実際の物理でしなります）
4. バトル

| 操作 | PC | スマホ |
|---|---|---|
| チャージ → 攻撃 | 左クリック or スペース長押し → 離す | 画面を長押し → 離す |
| 移動 | ← → / A D | 左下の ◀ ▶ |
| ガード | 相手から離れる方向へ移動中はダメージ軽減（相手の反作用が増える） | 同左 |
| ポーズ | Esc / 上部のボタン | 上部のボタン |

コツ：柔らかい角は振った直後に先端が遅れてしなります。先端が戻ってくる瞬間に当てると **WHIP!**。チャージが大きいほど強く振れて突進も伸びますが、隙も大きくなります。攻撃後の揺れはリセットされないので、揺れを利用すると連続攻撃につながります。

自作の角は「保存」でブラウザに保存、「JSON書き出し／読み込み」で共有できます。

```json
{ "version": 1, "name": "My Horn", "material": "rubber", "vertices": [[0, 0], [20, -40], [40, -100], [15, -120], [-10, -30]] }
```

座標は角の根元を (0,0)、x が牛の前方、y が下向き。**HP・硬度などの能力値は含めません**（読み込み側が材質と形状から計算します。能力値らしきキーがあれば拒否します）。

## 3. CPU 戦の実行方法

```bash
npm install
npm run dev        # http://localhost:5173
```

CPU 戦は完全オフラインで動きます（物理はブラウザ内で 120Hz 固定ステップ）。
CPU は自分の角の実形状・首の慣性・突進量から「チャージ量×間合い→衝突速度」を事前シミュレーションした表を持ち、それを使って間合いとタイミングを決めます。HARD はさらに角のしなりの位相や相手の硬直・チャージを読み、ガードも使います。

## 4. オンライン対戦の仕組み

```
ブラウザ A ──入力(押下中か・移動方向)──▶            ◀──入力── ブラウザ B
           ◀──スナップショット 30Hz・イベント── 対戦サーバー ──▶
                                         （Match を 120Hz 固定ステップで実行）
```

- **サーバー権威型**：クライアントは入力だけを送ります。衝突判定・HP・角の破損・融解・勝敗はサーバーの `Match`（クライアントの CPU 戦と同じ共通 TypeScript モジュール）が確定します。
  通信が止まってもクライアントだけで試合が進むことはありません（切断中は試合を一時停止し、猶予 20 秒を過ぎたら不戦敗）。
- **同期内容**：牛の座標・首の角度・角の節点（変形状態）・チャージ状態・HP・最大HP・角の形状リビジョン（破損/融解で形が変わると多角形を再送）・ひび・融解度・試合時間・勝敗。
- **遅延対策**：受信したスナップショットを約 110ms 遅らせて補間表示。自分のチャージゲージだけは入力から即時に予測表示します。
- **角の共有**：入室時に角 JSON を送信 → サーバーが検証・クリーンアップし、HP を材質と形状から計算して両者に配布します。
- **セキュリティ**：メッセージのスキーマ検証、パケット上限 16KB、頂点数・座標範囲の制限、入力 40 回/秒・全体 60 回/秒のレート制限、ルーム定員 2、推測されにくい 6 文字コード（31^6 ≒ 8.9 億通り、暗号学的乱数）と参加失敗回数の制限、入力は接続に紐づくスロットにのみ適用（偽装不可）、放置ルームの自動終了、無応答接続の切断、再接続トークンによる復帰、Origin 制限、1 IP あたりの同時接続数制限（Node 版）。

### Durable Objects と Node.js 常駐サーバーの選択

推奨構成は Cloudflare Workers + Durable Objects でしたが、**本作の既定は Node.js 常駐 WebSocket サーバー（`server/src/node.ts`）** にしています。理由：

- 本作はサーバーで 60Hz のリアルタイム物理を回し続けるため、Durable Object の WebSocket Hibernation（休止中は課金されない仕組み）を使えません。Cloudflare の料金表では、休止できずにメモリ上にある間は実時間で Duration（GB 秒）課金され、`accept()` した WebSocket は接続中ずっと課金対象になります。
- Durable Object の CPU 時間上限は 1 回の呼び出しあたり既定 30 秒で、受信メッセージごとにリセットされます。試合中は入力が届き続けるので実用上は収まりますが、タイマーだけで長時間計算し続ける構成は上限やエビクションの影響を受けやすくなります。
- 常駐プロセスなら 1 プロセスで多数の部屋を安定した間隔で回せ、ローカルテストも同じコードで行えます。

それでも **Durable Objects 版（`server/src/worker.ts` + `wrangler.toml`）も同じサーバーコアで用意**しています。小規模なら無料枠でも動かせますが、1 つの Durable Object がすべての部屋を持つ簡易構成なので、大人数には Node 版を使ってください。

## 5. ローカル環境構築

必要なもの：Node.js 20 以上

```bash
git clone https://github.com/<GitHubユーザー名>/kinggnu.git
cd kinggnu
npm install

# ターミナル1：対戦サーバー（ws://localhost:8787/ws）
npm run dev:server
# ターミナル2：フロントエンド（http://localhost:5173）
npm run dev
```

localhost で開くと自動で `ws://localhost:8787/ws` に接続します。別端末で試す場合は ONLINE 画面の「接続先サーバー」に URL を入力できます。

テスト・型チェック・ビルド：

```bash
npm run typecheck   # shared / client / server
npm test            # 物理・当たり判定・材質・ダメージ・CPU 戦の単体テスト + 対戦サーバー結合テスト
npm run build       # client/dist と server/dist/server.mjs
```

| ディレクトリ | 内容 |
|---|---|
| `shared/` | 物理・当たり判定・材質・ダメージ・試合・CPU・通信プロトコル（クライアントとサーバー共通） |
| `client/` | React + Vite + Canvas。画面・描画・入力・効果音（WebAudio で合成したオリジナル音） |
| `server/` | 対戦サーバー（`core/` がトランスポート非依存の本体、`node.ts` が ws 版、`worker.ts` が Durable Objects 版） |

## 6. GitHub Pages への公開手順

1. GitHub に公開リポジトリ `kinggnu` を作って push
   ```bash
   gh auth login                       # 未ログインなら
   gh repo create kinggnu --public --source=. --remote=origin --push
   ```
2. リポジトリの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** にする
3. （オンライン対戦を使うなら）**Settings → Secrets and variables → Actions → Variables** に `VITE_SERVER_URL`（例 `wss://kinggnu-server.example.com/ws`）を追加
4. `main` に push すると `.github/workflows/pages.yml` が型チェック・テスト・ビルドして `https://<GitHubユーザー名>.github.io/kinggnu/` に公開します

Vite の `base` は本番ビルドで `/kinggnu/`（Actions ではリポジトリ名から自動設定）。別のパスで配信する場合は `VITE_BASE` を指定してください。

## 7. 対戦サーバーのデプロイ手順

### A. Node.js 版（推奨）

任意の常駐環境（Fly.io / Render / Railway / VPS など）で動きます。

```bash
npm install
npm run build:server
PORT=8787 ALLOWED_ORIGINS=https://<GitHubユーザー名>.github.io node server/dist/server.mjs
```

Docker の場合：

```bash
docker build -f server/Dockerfile -t kinggnu-server .
docker run -p 8787:8787 -e ALLOWED_ORIGINS=https://<GitHubユーザー名>.github.io kinggnu-server
```

HTTPS 化（`wss://`）はホスティング側の TLS 終端かリバースプロキシで行い、そのURL + `/ws` を `VITE_SERVER_URL` に設定します。ヘルスチェックは `GET /health`。

### B. Cloudflare Workers + Durable Objects 版（オプション）

```bash
cd server
npx wrangler login
# wrangler.toml の ALLOWED_ORIGINS を GitHub Pages のオリジンに変更
npx wrangler deploy
```

`wss://kinggnu-server.<アカウント>.workers.dev/ws` を `VITE_SERVER_URL` に設定します。
GitHub Actions から出す場合は Secrets に `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を登録し、`Deploy server to Cloudflare` ワークフローを手動実行します。**トークンや API キーはリポジトリに含めないでください。**

## 自宅の Windows PC で対戦サーバーを動かす（Cloudflare Tunnel）

既存のトンネル（例: yein-pc）に Public Hostname を追加して公開する構成です。

| 項目 | 値 |
|---|---|
| 対戦サーバー | `127.0.0.1:8787`（PC 内からのみ。外部へはトンネル経由だけ） |
| Public Hostname | `kinggnu.yein.jp` → `http://127.0.0.1:8787` |
| クライアントの接続先 | `client/.env.production` の `VITE_SERVER_URL=wss://kinggnu.yein.jp`（`/ws` は自動で補う） |
| 許可する Origin | `https://dvyozakura.github.io`, `http://localhost:5173` |

ウィンドウを開かずにバックグラウンドで動かすスクリプトを `server/windows/` に用意しています。

| ファイル | 役割 |
|---|---|
| `start-hidden.vbs` | ダブルクリックで、窓なしでサーバーを起動（落ちても自動再起動・最新コードを自動ビルド） |
| `stop-server.cmd` | サーバーを止める |
| `install-autostart.ps1` | Windows にサインインしたら自動で起動するよう登録（管理者権限不要） |
| `uninstall-autostart.ps1` | 自動起動の登録を外す |

ログは `server/logs/server.log`、動作確認は http://127.0.0.1:8787/health 。ポートを変える場合は環境変数 `PORT` を設定し、Public Hostname 側も合わせてください。

## 8. 使用技術

- TypeScript / React 18 / Vite 5 / HTML Canvas 2D
- 独自の物理エンジン：Verlet + Position Based Dynamics（多節点の角）、SAT による凸多角形衝突、速度適応サブステップ
- 幾何処理：非ゼロ巻き数ラスタ化、チャンファー距離変換、Dijkstra による中心線、外周追跡 + Ramer–Douglas–Peucker、耳切り法 + Hertel–Mehlhorn 凸分解
- 通信：WebSocket（Node: `ws` / Cloudflare Durable Objects）、サーバー権威 + スナップショット補間
- テスト：Node.js 標準のテストランナー（`node:test`）+ tsx
- 画像・音はすべてコードで描画・合成したオリジナル素材です

## ライセンス

MIT
