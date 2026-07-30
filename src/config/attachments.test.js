import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MAX_BYTES,
  checkFile,
  describeAttachments,
  extensionOf,
  kindOf,
  resourceOf,
} from './attachments.js';

const MB = 1024 * 1024;

describe('kindOf', () => {
  it('sorts the three families apart', () => {
    assert.equal(kindOf('image/jpeg'), 'image');
    assert.equal(kindOf('video/mp4'), 'video');
    assert.equal(kindOf('application/pdf'), 'file');
  });

  it('accepts what an iPhone actually shoots', () => {
    // HEIC is the iOS default. Refusing it refuses the camera roll of every
    // user who has never opened the setting.
    assert.equal(kindOf('image/heic'), 'image');
  });

  it('ignores the charset a client appends', () => {
    assert.equal(kindOf('TEXT/CSV; charset=utf-8'), 'file');
  });

  it('refuses an executable', () => {
    assert.equal(kindOf('application/x-msdownload'), null);
  });

  it('survives a missing type', () => {
    assert.equal(kindOf(undefined), null);
    assert.equal(kindOf(''), null);
  });
});

describe('resourceOf', () => {
  it('stores a document raw, not as an image', () => {
    // A PDF uploaded as an image comes back as a picture of its first page,
    // which silently destroys the thing somebody attached.
    assert.equal(resourceOf('application/pdf'), 'raw');
    assert.equal(resourceOf('video/quicktime'), 'video');
    assert.equal(resourceOf('image/png'), 'image');
  });
});

describe('checkFile', () => {
  it('passes an ordinary photograph', () => {
    const verdict = checkFile({ mime: 'image/jpeg', size: 3 * MB, name: 'site.jpg' });
    assert.equal(verdict.ok, true);
    assert.equal(verdict.kind, 'image');
  });

  it('lets a video be far larger than a photo', () => {
    // 40MB is a refusal for a photo and unremarkable for a walkthrough.
    assert.equal(checkFile({ mime: 'video/mp4', size: 40 * MB }).ok, true);
    assert.equal(checkFile({ mime: 'image/jpeg', size: 40 * MB }).ok, false);
  });

  it('names the file and its real limit when refusing on size', () => {
    const verdict = checkFile({ mime: 'image/png', size: 30 * MB, name: 'plan.png' });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /plan\.png/);
    assert.match(verdict.reason, /12MB/);
    // The old message named the wrong family entirely, which left people
    // guessing what they were allowed to send.
    assert.match(verdict.reason, /photos/i);
  });

  it('tells somebody what is allowed when refusing on type', () => {
    const verdict = checkFile({ mime: 'application/zip', size: 1 * MB, name: 'job.zip' });
    assert.equal(verdict.ok, false);
    assert.match(verdict.reason, /job\.zip/);
    assert.match(verdict.reason, /PDF/);
  });

  it('accepts a file sitting exactly on the limit', () => {
    assert.equal(checkFile({ mime: 'application/pdf', size: MAX_BYTES.file }).ok, true);
    assert.equal(checkFile({ mime: 'application/pdf', size: MAX_BYTES.file + 1 }).ok, false);
  });

  it('does not refuse on size when the size is unknown', () => {
    // fileFilter runs before any bytes are counted; the real check happens
    // later, and this stage must not guess.
    assert.equal(checkFile({ mime: 'image/jpeg' }).ok, true);
  });
});

describe('extensionOf', () => {
  it('supplies a name for a file that arrived without one', () => {
    assert.equal(extensionOf('image/heic'), 'heic');
    assert.equal(extensionOf('application/vnd.ms-excel'), 'xls');
    assert.equal(extensionOf('application/zip'), null);
  });
});

describe('describeAttachments', () => {
  it('says nothing when there is nothing', () => {
    assert.equal(describeAttachments([]), '');
    assert.equal(describeAttachments(), '');
  });

  it('names one of a kind', () => {
    assert.equal(describeAttachments([{ kind: 'image' }]), 'Photo');
    assert.equal(describeAttachments([{ kind: 'video' }]), 'Video');
    // "Sent an image" was wrong the moment somebody sent a spreadsheet.
    assert.equal(describeAttachments([{ kind: 'file' }]), 'Document');
  });

  it('counts several of one kind', () => {
    assert.equal(describeAttachments([{ kind: 'image' }, { kind: 'image' }]), '2 photos');
  });

  it('falls back to a plain count when the kinds are mixed', () => {
    const mixed = [{ kind: 'image' }, { kind: 'file' }, { kind: 'video' }];
    assert.equal(describeAttachments(mixed), '3 attachments');
  });

  it('treats an unlabelled attachment as a file rather than crashing', () => {
    assert.equal(describeAttachments([{}]), 'Document');
  });
});
