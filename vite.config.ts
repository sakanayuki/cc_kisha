import { defineConfig } from 'vite';

// GitHub Pages はリポジトリ名のサブパス配下で配信されるため相対パスでビルドする
export default defineConfig({
  base: './',
});
