export class Packer {
    constructor(code, trans) {
        this.code = unescape(encodeURIComponent(code));
        this.trans = trans;
    }

    pack() {
        // The "core" algorithm to find an optimal packing of the source code.
        const dp = Array(this.code.length);
        for (let index = 0; index < this.code.length; index++) {
            let best = null;
            for (let size = 1; size <= 4; size++) {
                const startIndex = index - size + 1;
                if (startIndex < 0 || (startIndex !== 0 && dp[startIndex - 1] === null))
                    continue;

                const bytes = this.findCandidate({ index: startIndex, size: size });
                if (bytes === null)
                    continue;

                const newCost = (startIndex !== 0 ? dp[startIndex - 1].cost : 0) + 1;
                if (best === null || newCost < best.cost)
                    best = { bytes: bytes, cost: newCost, prev: startIndex - 1, size: size };
            }
            dp[index] = best;
        }

        const data = this.traceDp(dp);
        const canPack = dp[dp.length - 1] !== null;

        // Perform a second pass to look for partial byte sequences. The search
        // is done in such a way that partials are prioritized at the end of the
        // source, as in most cases, this is what the user should expect.
        let bestPart = null, bestIndex = -1;
        for (let index = 0; index < this.code.length; index++) {
            if (index !== 0 && dp[index - 1] === null)
                continue;

            const newCost = (index !== 0 ? dp[index - 1].cost : 0) + 1;
            for (let size = 1; size <= 4; size++) {
                if (index >= this.code.length)
                    continue;

                const bytes = this.findCandidate({ index: index, size: size }, true);
                if (bytes === null)
                    continue;

                const newIndex = index + bytes.length - 1;
                if (bestPart === null || newIndex > bestIndex ||
                    (newIndex == bestIndex && newCost <= bestPart.cost)) {
                    bestPart = { bytes: bytes, cost: newCost, prev: index - 1, size: size };
                    bestIndex = newIndex;
                }
            }
        }

        const partDp = [ ...dp ];
        partDp[bestIndex] = bestPart;

        return { data: data, partData: this.traceDp(partDp), canPack: canPack };
    }

    traceDp(dp) {
        // Calculate the highest `index` where `dp[index] !== null`.
        let bestIndex = -1;
        for (let index = this.code.length - 1; index >= 0; index--) {
            if (dp[index] !== null) {
                bestIndex = index;
                break;
            }
        }

        // Trace back `dp` to obtain the whole solution.
        const data = [];
        for (let curIndex = bestIndex; curIndex !== -1; curIndex = dp[curIndex].prev)
            data.push({
                bytes: dp[curIndex].bytes,
                index: dp[curIndex].prev + 1,
                size: dp[curIndex].size
            });

        return data.reverse();
    }

    findCandidate(range, partial = false) {
        const tryBytes = data => {
            const bytes = [];
            for (let pos = 0; pos < data.length; pos++) {
                if (range.index + pos >= this.code.length)
                    return partial ? bytes : null;

                const { start, end } = data[pos];
                const targetByte = this.code.charCodeAt(range.index + pos);

                let isFound = false;
                for (let byte = start; byte <= end; byte++) {
                    if (this.trans[byte] === targetByte) {
                        bytes.push(byte);
                        isFound = true;
                        break;
                    }
                }

                if (!isFound)
                    return partial ? bytes : null;
            }
            return bytes;
        };

        const candidates = [];

        switch (range.size) {
            case 1:
                candidates.push(tryBytes(
                    [ { start: 0x00, end: 0x7F } ]
                ));
                break;
            case 2:
                candidates.push(tryBytes(
                    [ { start: 0xC2, end: 0xDF },
                      { start: 0x80, end: 0xBF } ]
                ));
                break;
            case 3:
                candidates.push(tryBytes(
                    [ { start: 0xE0, end: 0xE0 },
                      { start: 0xA0, end: 0xBF },
                      { start: 0x80, end: 0xBF } ]
                ));
                candidates.push(tryBytes(
                    [ { start: 0xE1, end: 0xEC },
                      { start: 0x80, end: 0xBF },
                      { start: 0x80, end: 0xBF } ]
                ));
                candidates.push(tryBytes(
                    [ { start: 0xED, end: 0xED },
                      { start: 0x80, end: 0x9F },
                      { start: 0x80, end: 0xBF } ]
                ));
                candidates.push(tryBytes(
                    [ { start: 0xEE, end: 0xEF },
                      { start: 0x80, end: 0xBF },
                      { start: 0x80, end: 0xBF } ]
                ));
                break;
            case 4:
                candidates.push(tryBytes(
                    [ { start: 0xF0, end: 0xF0 },
                      { start: 0x90, end: 0xBF },
                      { start: 0x80, end: 0xBF },
                      { start: 0x80, end: 0xBF } ]
                ));
                candidates.push(tryBytes(
                    [ { start: 0xF1, end: 0xF3 },
                      { start: 0x80, end: 0xBF },
                      { start: 0x80, end: 0xBF },
                      { start: 0x80, end: 0xBF } ]
                ));
                candidates.push(tryBytes(
                    [ { start: 0xF4, end: 0xF4 },
                      { start: 0x80, end: 0x8F },
                      { start: 0x80, end: 0xBF },
                      { start: 0x80, end: 0xBF } ]
                ));
                break;
        }

        if (partial) {
            let maxLength = 0, result = null;
            for (const candidate of candidates) {
                const length = candidate.length;
                if (length > maxLength) {
                    maxLength = length;
                    result = candidate;
                }
            }
            return result;
        } else {
            for (const candidate of candidates)
                if (candidate !== null)
                    return candidate;
            return null;
        }
    }
}
