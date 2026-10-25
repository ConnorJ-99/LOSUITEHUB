import { describe, expect, it } from 'vitest'
import { attr, descendants, kid, parseXml, path, textAt, XmlParseError } from './xmlRead'

describe('xml reader', () => {
  const doc = parseXml(`<?xml version="1.0" encoding="UTF-8"?>
<!-- comment -->
<MESSAGE xmlns="http://www.mismo.org/residential/2009/schemas" xmlns:xlink="http://www.w3.org/1999/xlink">
  <DEAL SequenceNumber="1">
    <NAME><FullName>Smith &amp; Sons &lt;LLC&gt; &#39;x&#39; &#x41;</FullName></NAME>
    <ASSET xlink:label="ASSET_1" Other='single "quoted"'/>
    <ASSET xlink:label="ASSET_2"><X><![CDATA[a < b]]></X></ASSET>
    <ULAD:EXT xmlns:ULAD="u"><ULAD:Flag>true</ULAD:Flag></ULAD:EXT>
  </DEAL>
</MESSAGE>`)

  it('reads elements, text and entities', () => {
    expect(doc.local).toBe('MESSAGE')
    expect(textAt(doc, 'DEAL', 'NAME', 'FullName')).toBe(`Smith & Sons <LLC> 'x' A`)
  })

  it('reads attributes by local name and handles both quote styles', () => {
    const assets = path(doc, 'DEAL', 'ASSET')
    expect(assets.map((a) => attr(a, 'label'))).toEqual(['ASSET_1', 'ASSET_2'])
    expect(assets[0].attrs.Other).toBe('single "quoted"')
  })

  it('keeps CDATA text as-is', () => {
    expect(textAt(doc, 'DEAL', 'ASSET', 'X')).toBe('a < b')
  })

  it('matches namespaced elements by local name', () => {
    expect(descendants(doc, 'Flag')[0].text).toBe('true')
    expect(kid(kid(doc, 'DEAL'), 'EXT')?.name).toBe('ULAD:EXT')
  })

  it('rejects malformed XML with a clear error', () => {
    expect(() => parseXml('<A><B></A>')).toThrow(XmlParseError)
    expect(() => parseXml('<A>')).toThrow(/Unclosed element/)
    expect(() => parseXml('not xml')).toThrow(/No root/)
  })
})
