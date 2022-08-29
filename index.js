import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { defaultHighlightStyle, StreamLanguage,
         syntaxHighlighting } from '@codemirror/language';
import { ruby } from '@codemirror/legacy-modes/mode/ruby';
import { Compartment, EditorState, Prec } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, gutter, lineNumbers, keymap,
         placeholder } from '@codemirror/view';

import { Packer } from './packer.js';

function escapeByte(byte) {
    if (byte === 0x00) return '\\0';
    if (byte === 0x09) return '\\t';
    if (byte === 0x0A) return '\\n';
    if (byte === 0x0C) return '\\f';
    if (byte === 0x0D) return '\\r';
    return String.fromCharCode(byte);
}

function byteToColor(byte) {
    return byte <= 0x7F ? '#aaaaaa'
         : byte <= 0xBF ? '#4e8bbf'
         : byte <= 0xEF ? '#ec9a29'
         :                '#6e44ff';
}

function updateTable(trans) {
    const trTable = document.getElementById('tr-table');
    trTable.innerHTML = '';

    for (let byte = 0x00; byte <= 0xF4; byte++) {
        const fromText = byte.toString(16).padStart(2);
        const toText = escapeByte(trans[byte]).padStart(2);

        const cell = document.createElement('span');
        cell.innerText = `${fromText}\n${toText}`;
        cell.style.color = byteToColor(byte);

        trTable.appendChild(cell);
    }
}

let trans = Array(256).keys();
updateTable(trans);

const highlightListener = new Compartment();
const trListener = new Compartment();

const extensions = {
    base: [
        history(),
        syntaxHighlighting(defaultHighlightStyle),
        keymap.of(defaultKeymap + historyKeymap),
        StreamLanguage.define(ruby)
    ],
    oneLine: EditorState.transactionFilter.of(
        tr => tr.newDoc.lines > 1 ? [] : tr)
};

const trFromEditor = new EditorView({
    state: EditorState.create({
        doc: "''",
        extensions: [
            ...extensions.base,
            extensions.oneLine,
            placeholder('from_str'),
            trListener.of([])
        ]
    }),
    parent: document.getElementById('tr-from'),
});

const trToEditor = new EditorView({
    state: EditorState.create({
        doc: "''",
        extensions: [
            ...extensions.base,
            extensions.oneLine,
            placeholder('to_str'),
            trListener.of([])
        ]
    }),
    parent: document.getElementById('tr-to')
});

const sourceEditor = new EditorView({
    state: EditorState.create({
        extensions: [
            highlightListener.of([]),
            ...extensions.base,
            lineNumbers()
        ]
    }),
    parent: document.getElementById('source')
});

const outputEditor = new EditorView({
    state: EditorState.create({
        extensions: [
            ...extensions.base,
            lineNumbers(),
            EditorState.readOnly.of(true),
            placeholder('Output')
        ],
    }),
    parent: document.getElementById('output')
});

(async () => {
    // Initialize the Ruby VM.
    const { DefaultRubyVM } = window['ruby-wasm-wasi'];
    const response = await fetch('https://cdn.jsdelivr.net/npm/ruby-head-wasm-wasi@0.3.0-2022-04-20-a/dist/ruby+stdlib.wasm');
    const buffer = await response.arrayBuffer();
    const module = await WebAssembly.compile(buffer);
    const { vm } = await DefaultRubyVM(module);

    function getDecorations(view) {
        const code = sourceEditor.state.doc.toString();
        const trFromText = trFromEditor.state.doc.toString();
        const trToText = trToEditor.state.doc.toString();

        let trans = null;
        const trTable = document.getElementById('tr-table');

        try {
            trans = JSON.parse(
                // For some odd reason, the VM uses ASCII-8BIT encoding. The
                // magic header is needed to switch it back to UTF-8.
                vm.eval(`
                    # encoding: UTF-8
                    res = [*0x00..0xFF].pack('c*').tr${trFromText},${trToText}
                    res.bytes
                `.trim())
            );

            for (const e of [ trFromEditor.dom, trToEditor.dom, trTable ])
                e.classList.remove('tr-error');

            updateTable(trans);
        } catch (err) {
            for (const e of [ trFromEditor.dom, trToEditor.dom, trTable ])
                e.classList.add('tr-error');

            updateTable(Array(256).fill(32));
        }

        const widgets = [];
        let packedCode = '';

        if (trans !== null) {
            const packer = new Packer(code, trans);
            const { data, partData, canPack } = packer.pack();

            // Highlight the source code by UTF-8 byte sequences.
            for (let charIndex = 0; charIndex < partData.length; charIndex++) {
                const { bytes, index } = partData[charIndex];
                const color = byteToColor(bytes[0]) + (charIndex % 2 === 0 ? '60' : '80');
                const decoration = Decoration.mark({
                    attributes: {
                        class: 'hl',
                        style: `background-color: ${color}`
                    }
                });

                widgets.push(decoration.range(index, index + bytes.length));
            }

            if (canPack) {
                let packedStr = data
                    .map(char => new TextDecoder().decode(new Uint8Array(char.bytes)))
                    .join('');

                const singleQuotes = (packedStr.match(/'/g) || []).length;
                const doubleQuotes = (packedStr.match(/"/g) || []).length;

                // Escape the quotes with backslashes to avoid `SyntaxError`.
                if (singleQuotes <= doubleQuotes) {
                    packedStr = packedStr.replace(/'/g, "\\'");
                    packedCode = `eval'${packedStr}'.b.tr${trFromText},${trToText}`;
                } else {
                    packedStr = packedStr.replace(/"/g, '\\"');
                    packedCode = `eval"${packedStr}".b.tr${trFromText},${trToText}`;
                }
            }
        }

        outputEditor.dispatch({
            changes: {
                from: 0, to: outputEditor.state.doc.length,
                insert: packedCode
            }
        });

        const charCount = document.getElementById('char-count');
        charCount.textContent = `${packedCode ? [ ...packedCode ].length : '--'} chars`;

        return Decoration.set(widgets, false);
    }

    sourceEditor.dispatch({
        effects: highlightListener.reconfigure(
            ViewPlugin.fromClass(
            	class {
            		constructor(view) {
            			this.decorations = getDecorations(view);
            		}

            		update(update) {
            			this.decorations = getDecorations(update.view);
            		}
            	},
            	{ decorations: v => v.decorations }
            )
        )
    });

    for (const editor of [trFromEditor, trToEditor]) {
        editor.dispatch({
            effects: trListener.reconfigure(
                EditorView.updateListener.of(update => {
                    // Hack to call for `highlightListener` when `tr` changes.
                    sourceEditor.dispatch([]);
                })
            )
        })
    }
})();
