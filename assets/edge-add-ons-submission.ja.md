# Unquote Microsoft Edge Add-ons 提出資料（日本語）

> 対象：次回の拡張機能リリース
>
> 拡張機能 ID：`amdbhljchamjbhknbamkcemccmelegdp`
>
> この資料は Partner Center の日本語ストア掲載情報に使用します。

## 1. ストア掲載情報

### 拡張機能名

Unquote - エスケープ JSON 展開・JSONL ビューア

名前はパッケージ内の `apps/extension/public/_locales/ja/messages.json` と一致させます。

### 短い説明

文字列化された JSON を展開し、JSONL をローカルで閲覧できます。

短い説明はパッケージの日本語マニフェスト `description` から取得されます。変更時は
新しい ZIP パッケージをアップロードしてください。

### 説明

Unquote は、ブラウザ内で動作する JSON / JSONL ビューアです。文字列値の中に
エンコードされた JSON を検出して再帰的に展開し、読みやすいインタラクティブな
ツリーとして表示します。API レスポンス、ログ、AI モデルの出力、エージェントの
ツール呼び出し記録の確認に適しています。

主な機能：

- JSON と JSONL を自動判別し、文字列化された JSON を再帰的に展開
- ネストしたデータをツリー、パス、型、シンタックスハイライトで確認
- キー、値、JSONPath をレコード横断で検索
- JSONL の成功、失敗、ネストしたパス、フィールド概要を表示
- Codex と Claude Code のログを認識し、会話、ツール呼び出し、タイムラインを表示
- 処理後の JSON / JSONL をコピーまたはエクスポート
- ローカルファイルを開くかドロップし、選択した JSON を右クリックメニューから送信
- ライト、ダーク、システムテーマに対応
- ユーザーのデータを外部へ送信せず、すべてローカルで処理

Unquote はアカウント不要で、広告や閲覧行動の追跡もありません。

### 検索語句

Partner Center の検索語句欄には、重複を避けて次を入力します。

- JSON
- JSONL
- JSON ビューア
- JSON フォーマッター
- ログビューア
- 開発者ツール
- エージェントログ

### URL と分類

| 項目 | 推奨値 |
|---|---|
| カテゴリ | Developer tools |
| Web サイト | `https://unquote.xingkaixin.me/` |
| サポート | `https://github.com/xingkaixin/unquote/issues` |
| プライバシーポリシー | 公開済みの `https://unquote.xingkaixin.me/privacy` |
| 市場 | 利用可能なすべての市場 |

## 2. 画像素材

Partner Center の日本語掲載情報に、次の 4 枚をこの順序でアップロードします。

1. [ダークテーマ：JSON の再帰展開](edge-add-ons-screenshot-ja-dark-json-tree-1280x800.jpg)
2. [ダークテーマ：エージェントセッション](edge-add-ons-screenshot-ja-dark-agent-session-1280x800.jpg)
3. [ライトテーマ：JSONL 検索](edge-add-ons-screenshot-ja-light-jsonl-search-1280x800.jpg)
4. [ライトテーマ：エラー診断](edge-add-ons-screenshot-ja-light-error-diagnostics-1280x800.jpg)

追加素材：

- [300×300 拡張機能ロゴ](logo-300x300.png)
- [440×280 小型プロモーション画像](chrome-web-store-small-promo-440x280.png)
- [1400×560 大型プロモーション画像](chrome-web-store-marquee-1400x560.png)

Edge Add-ons ではスクリーンショットを最大 6 枚登録でき、サイズは 1280×800 または
640×480 です。小型・大型プロモーション画像は言語ごとに設定できますが、現在の
画像には言語固有のテキストがないため、日本語掲載情報にも同じ画像を使用します。

## 3. 権限とデータ処理の説明

### 単一目的

ユーザーが明示的に提供した JSON、JSONL、エージェントログを端末内で解析、展開、
検索、表示します。

### `contextMenus`

テキスト選択時の右クリックメニューに「Unquote で開く」を追加します。ユーザーが
この項目を選んだ場合に限り、選択されたテキストを Unquote で開きます。

### `storage`

選択されたテキストを新しい Unquote ページへ渡すため、セッションストレージを
使用します。データは最長 5 分間だけ保持され、最初の読み取り直後に削除されます。

### `clipboardRead`

ユーザーが貼り付け操作を行い、クリップボードが JSON / JSONL ファイルを含む場合
に限り読み取ります。バックグラウンドで監視することはありません。

### ホスト権限と外部通信

ホスト権限を要求せず、ユーザーが提供した内容をデベロッパーまたは第三者の
サーバーへ送信しません。広告、分析、プロファイリングにも使用しません。

## 4. 認定テスト用メモ

> Unquote はログインやテストアカウントを必要としません。拡張機能アイコンを
> クリックしてメインページを開き、入力欄の下にあるサンプルを使用してください。
> 「エスケープされた API レスポンス」で再帰展開、「Codex ロールアウト JSONL」で
> エージェントセッション、「有効・無効混在の JSONL」で行ごとのエラー診断を確認
> できます。ホスト権限は要求せず、すべてローカルで処理します。

右クリックメニューの確認：

1. 任意のウェブページで JSON テキストを選択します。
2. 右クリックして「Unquote で開く」を選択します。
3. 新しい拡張機能ページに選択した内容が表示されます。

キーボードショートカット：

- Windows / Linux：`Ctrl+Shift+U`
- macOS：`Command+Shift+U`

## 5. 提出前チェックリスト

- `pnpm check` を実行
- `pnpm zip-extension` を実行
- ZIP のルートに `manifest.json` があることを確認
- ZIP に `_locales/ja/messages.json` があることを確認
- バージョンが Edge Add-ons の公開済みバージョンより大きいことを確認
- Partner Center に日本語の掲載情報を追加
- 日本語の説明と 300×300 ロゴを登録
- 4 枚の日本語スクリーンショットを登録
- 短い説明が日本語マニフェストと一致することを確認
- Web サイト、サポート、プライバシーポリシー URL が公開されていることを確認
- 認定テスト用メモを登録
- 提出後に認定状況と公開範囲を確認

## 6. 公式資料

- https://learn.microsoft.com/microsoft-edge/extensions/publish/publish-extension
- https://learn.microsoft.com/microsoft-edge/extensions/publish/create-dev-account
- https://learn.microsoft.com/microsoft-edge/extensions/publish/update
