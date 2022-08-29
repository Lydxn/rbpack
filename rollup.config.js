import { nodeResolve } from '@rollup/plugin-node-resolve';

export default {
    input: './src/index.js',
    output: {
        file: './src/bundle/index.js',
        format: 'iife'
    },
    plugins: [ nodeResolve() ]
}
