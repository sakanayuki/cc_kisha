# おもちゃの汽車

画面をなぞって木のレールを敷き、列車を走らせるゲームです(Vite + TypeScript)。

- **レール**: なぞった線に沿って直線・カーブが並ぶ。既存レールの端から続けたり、端どうしを繋いでループにできる
- **発車**: レールをタップするとその位置から列車が走る。レールが途切れると転倒してフェードアウト
- **ゴミ箱**: 長押しで全レールを消去

## 開発

```
npm install
npm run dev     # 開発サーバー
npm run build   # dist/ にビルド
```

## 公開(GitHub Pages)

`main` への push で `.github/workflows/deploy.yml` がビルドして Pages にデプロイします。
初回のみ、リポジトリの Settings → Pages → Source を **GitHub Actions** にしてください。

## 素材

`Wooden_toy_train_on_tracks_*.jpg` から `tools/extract.py` で車両・レールを切り出した透過PNGが `src/assets/` にあります。

```
python3 tools/extract.py Wooden_toy_train_on_tracks_20261023171254.jpg src/assets
```
