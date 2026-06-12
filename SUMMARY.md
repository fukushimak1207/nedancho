# SUMMARY — 2026-06-11

## 今日やったこと

- **ねだん帳 Ver 1.0 を要件定義からゼロで作成し、公開まで完了**
  - 技術方針を FastAPI + Supabase 案から**オフラインPWA**(HTML + バニラJS + localStorage)に変更
    (理由: スーパー店内の弱い電波対応・月額0円・無料サーバーのスリープが「3秒判定」と相性が悪い)
  - MVP全機能: 品目/店舗/価格のCRUD、相場表示(30/90/365日平均・最安・最高)、±10%価格判定、最安値更新判定、JSONバックアップ
  - **100g単価方式**: 肉・魚は「値段+内容量(g)」入力 → 100g単価を自動計算して判定(品目ごとに切替可)
  - 日付ラベルを「購入日」→「入力日」に変更
  - 品目の並べ替え(▲▼)、店舗別の相場比較(最安バッジ)、よく使う順トグル、SVG価格推移グラフ
  - **GitHub Pages で公開**: https://fukushimak1207.github.io/nedancho/
  - **スマホ・PC間のデータ同期**: Google ドライブ + Apps Script 方式(更新時刻マージ+削除印で安全に合体)
- バグ修正: 判定境界値(ちょうど±10%)の浮動小数点誤差

## 作成・変更したファイル

- `~/projects/nedancho/` — index.html, app.js, style.css, sw.js, manifest.webmanifest, icon.svg, icon-maskable.svg, README.md, requirements.md, SYNC_SETUP.md, .gitignore
- `~/.claude/plans/nedancho-thrifty-squirrel.md` — 設計プラン
- `~/.claude/launch.json` — プレビュー用サーバー設定

## 未完了・次回やること

- **同期の最終確認**: Apps Script の設定(手順1・2)は完了済み。手順3(URL をPC・スマホ両方のアプリに貼り付け)の完了と、両端末で記録が合流するかの確認
- PC では今後 localhost ではなく公開URLを使う(データの保存場所が URL ごとに別なため)
- 機能候補(未着手): ひらがな検索、税込/税抜切替、買い物リスト(Phase4)、レシートOCR(Phase2)

## 重要な決定・メモ

- データはすべて端末内 + Google ドライブ(nedancho-data.json)。GitHub には価格データは一切入らない
- **同期URLは合鍵**。人に教えない
- アプリのファイルを更新したら **sw.js の CACHE_VERSION を上げる**(現在 v6)。上げないとスマホが古いキャッシュを使い続ける
- リポジトリは public(GitHub Pages の無料利用に必要)。コードのみで機密ゼロ確認済み

## サブPCで使う場合

```
cd "$env:USERPROFILE\projects"
git clone git@github.com:fukushimak1207/nedancho.git
```
