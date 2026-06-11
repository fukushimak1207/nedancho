# スマホ・PC間の同期 初期設定(1回だけ・約5分)

ねだん帳のデータを、あなたの Google ドライブを経由してスマホとPCで同期させるための設定です。
**月額0円**。Google の無料機能「Apps Script」を使います。

## しくみ

```
スマホのねだん帳 ←→ あなたのGoogleドライブ(nedancho-data.json) ←→ PCのねだん帳
```

- ドライブに `nedancho-data.json` という1つのファイルができ、そこが「データの倉庫」になります
- 記録すると数秒後に自動で倉庫に保存され、もう一方の端末はアプリを開いたときに自動で取り込みます
- 圏外のときは今まで通り端末内で動き、電波が戻ったら自動で同期します

## 手順

### 1. Apps Script を作る(PCでやるのがおすすめ)

1. **個人の Google アカウント**でログインした状態で https://script.google.com を開く
2. 「**新しいプロジェクト**」をクリック
3. 最初から書いてあるコードを全部消して、下のコードを貼り付ける
4. 上の「無題のプロジェクト」をクリックして名前を付ける(例: `ねだん帳同期`)

```javascript
// ねだん帳 同期用スクリプト
// あなたのGoogleドライブに nedancho-data.json を読み書きします
const FILE_NAME = 'nedancho-data.json';

function getFile_() {
  const files = DriveApp.getFilesByName(FILE_NAME);
  return files.hasNext() ? files.next() : null;
}

// アプリがデータを取りに来たとき
function doGet() {
  const f = getFile_();
  const text = f ? f.getBlob().getDataAsString('utf-8') : '';
  return ContentService.createTextOutput(text)
    .setMimeType(ContentService.MimeType.JSON);
}

// アプリがデータを保存しに来たとき
function doPost(e) {
  const text = e.postData.contents;
  JSON.parse(text); // 壊れたデータは保存しない(形式チェック)
  const f = getFile_();
  if (f) {
    f.setContent(text);
  } else {
    DriveApp.createFile(FILE_NAME, text, 'application/json');
  }
  return ContentService.createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
```

### 2. ウェブアプリとして公開する

1. 右上の「**デプロイ**」→「**新しいデプロイ**」
2. 左上の歯車マーク → 種類で「**ウェブアプリ**」を選ぶ
3. 設定を以下の通りに:
   - 次のユーザーとして実行: **自分**
   - アクセスできるユーザー: **全員**
4. 「デプロイ」をクリック
5. 「アクセスを承認」→ 自分のアカウントを選択
   - 「このアプリは Google で確認されていません」と出たら:
     **「詳細」→「ねだん帳同期(安全ではないページ)に移動」→「許可」**
     (自分で作ったスクリプトなので大丈夫です)
6. 表示された「**ウェブアプリの URL**」(`https://script.google.com/macros/s/…/exec`)をコピー

### 3. ねだん帳にURLを設定する(スマホとPC両方)

1. ねだん帳を開く → **設定タブ** → 「スマホ・PC間の同期」
2. コピーしたURLを貼り付けて「**URLを保存**」
3. 「✅ 最終同期: …」と出れば成功
4. **もう一方の端末でも同じURLを設定**すれば完了

## 知っておくこと

- **このURLは合鍵のようなものです。人に教えないでください**(URLを知っている人はあなたの価格データを読み書きできます)。保存されているのは食品の価格記録だけで、個人情報はありません
- 両方の端末で別々に記録しても、同期するときに賢く合体されます(消したものが復活したり、記録が消えたりしません)
- 「アクセスできるユーザー: 全員」という設定は「URLを知っている人なら誰でも」という意味です。URLは推測できない長いランダム文字列なので、教えない限り実質あなた専用です
