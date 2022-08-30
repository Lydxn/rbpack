# rbpack

*rbpack* is a browser editor for packing Ruby code as short as possible, created specifically for use in [Code Golf](https://code.golf/). See the site in action at https://lydxn.github.io/rbpack/.

## Mechanics

The term "packing" refers to shortening the source code by combining chunks of bytes into single Unicode characters. The packer works by transliterating your code in such a way that they form valid UTF-8 byte sequences. For example, take the following Ruby snippet:

```ruby
'puts'.tr('a-z', "\xE2-\xF3\x80-\xBF".b)  # => '񂁀'
```

It encodes `'puts'` by mapping the letters `'a-z'` to some other arrangement of bytes. As it happens, `'puts'` gets translated to `"\xF1\x82\x81\x80"`. Decoding it as `UTF-8` gives us the single unicode character `'񂁀'`. Essentially, we have managed to compress our source code by a `4:1` ratio (assuming that characters are counted the same as bytes).

## How to use

On the site, the top-left and top-right input boxes represent the transliteration parameters *(Note: the ordering is "backwards" from the example given above, so the top-left box takes the **destination** ranges, while the top-right box takes the **source** ranges)*. In the main editor, paste the source code you would like to be packed. If the transliteration happens to be valid UTF-8, the `Output` box will contain the packed code, with an `eval` at the beginning to run the packed string as code.
