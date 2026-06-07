import { assert, describe, it } from 'vitest';

import { formatMailtoLink } from './url.js';

// Parse a mailto: link the way a mail client does: recipient is the path,
// headers are the query parameters.
function parse(href: string) {
  const u = new URL(href);
  return {
    recipient: decodeURIComponent(u.pathname),
    subject: u.searchParams.get('subject'),
    body: u.searchParams.get('body'),
    extraParams: [...u.searchParams.keys()].filter((k) => k !== 'subject' && k !== 'body'),
    fragment: u.hash,
  };
}

describe('formatMailtoLink', () => {
  it('builds a valid link for a normal email', () => {
    const link = formatMailtoLink('alice@example.com', {
      subject: 'Reported PrairieLearn Issue',
      body: 'Hello Alice',
    });
    const parsed = parse(link);
    assert.equal(parsed.recipient, 'alice@example.com');
    assert.equal(parsed.subject, 'Reported PrairieLearn Issue');
    assert.equal(parsed.body, 'Hello Alice');
  });

  it('preserves a recipient containing a "?" (would otherwise start the query early)', () => {
    const link = formatMailtoLink('who?@example.com', { subject: 'S', body: 'B' });
    const parsed = parse(link);
    assert.equal(parsed.recipient, 'who?@example.com');
    assert.equal(parsed.subject, 'S');
    assert.equal(parsed.body, 'B');
  });

  it('preserves a recipient containing a "#" (would otherwise become a fragment)', () => {
    const link = formatMailtoLink('a#b@example.com', { subject: 'S', body: 'B' });
    const parsed = parse(link);
    assert.equal(parsed.recipient, 'a#b@example.com');
    assert.equal(parsed.subject, 'S');
    assert.equal(parsed.body, 'B');
    assert.equal(parsed.fragment, '');
  });

  it('preserves a recipient containing "&" without injecting extra params', () => {
    const link = formatMailtoLink('a&cc=evil@example.com', { subject: 'S', body: 'B' });
    const parsed = parse(link);
    assert.equal(parsed.recipient, 'a&cc=evil@example.com');
    assert.deepEqual(parsed.extraParams, []);
  });

  it('encodes spaces in the recipient as %20 (a literal space is not a valid URI)', () => {
    const link = formatMailtoLink('jane doe', { subject: 'S', body: 'B' });
    assert.match(link, /^mailto:jane%20doe\?/);
    assert.equal(parse(link).recipient, 'jane doe');
  });

  it('encodes spaces in header values as %20, not "+"', () => {
    const link = formatMailtoLink('bob@example.com', { subject: 'a b', body: 'c d' });
    // URLSearchParams would have produced "a+b"; a mail client renders "+" literally.
    assert.include(link, 'subject=a%20b');
    assert.include(link, 'body=c%20d');
    assert.equal(parse(link).body, 'c d');
  });

  it('preserves a literal "+" in a header value', () => {
    const link = formatMailtoLink('bob@example.com', { subject: 'S', body: 'a+b' });
    assert.equal(parse(link).body, 'a+b');
  });

  it('omits the query when there are no headers', () => {
    assert.equal(formatMailtoLink('alice@example.com', {}), 'mailto:alice%40example.com');
  });
});
