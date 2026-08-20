import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  minify: {
    compress: {
      keepNames: {
        class: true,
        function: true
      }
    },
    mangle: {
      keepNames: true
    }
  },
  clean: true,
  fixedExtension: false,
  target: 'es2020',
  outputOptions: {
    comments: false
  }
})
