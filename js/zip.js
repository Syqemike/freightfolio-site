/**
 * js/zip.js — minimal ZIP reader for the upload flows (CSP-safe, no dependencies).
 *
 * Extracts PDF/JPG/PNG entries from a .zip File/Blob in the browser using
 * DecompressionStream for deflated entries. The extracted files then go
 * through the normal per-file upload pipeline (validation, allowance,
 * duplicate detection), so archives can't bypass any server-side checks.
 *
 * Safety limits: max 25 entries, 25 MB per entry, 100 MB total uncompressed,
 * no nested zips, no encrypted entries, no zip64.
 */

(function (global) {
  "use strict";

  var MAX_ENTRIES = 25;
  var MAX_ENTRY_BYTES = 25 * 1024 * 1024;
  var MAX_TOTAL_BYTES = 100 * 1024 * 1024;
  var ALLOWED_EXT = { ".pdf": "application/pdf", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png" };

  function dv(buf, off, len) {
    return new DataView(buf, off, len);
  }

  function readU16(view, off) { return view.getUint16(off, true); }
  function readU32(view, off) { return view.getUint32(off, true); }

  function decodeName(bytes) {
    try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch (e) {
      // Fallback: treat bytes as latin-1-ish (cp437-ish) printable ASCII.
      var s = "";
      for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i] & 0xff);
      return s;
    }
  }

  function safeName(name) {
    var base = String(name || "").split(/[\\/]/).pop() || "file";
    var cleaned = base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_").slice(0, 120);
    return cleaned.replace(/^\.+/, "") || "file";
  }

  function extOf(name) {
    var i = name.lastIndexOf(".");
    return i >= 0 ? name.slice(i).toLowerCase() : "";
  }

  async function readBlob(blob, start, length) {
    var ab = await blob.slice(start, start + length).arrayBuffer();
    return new Uint8Array(ab);
  }

  async function inflateRaw(data) {
    // Zip "deflated" entries are raw deflate streams.
    var ds = new DecompressionStream("deflate-raw");
    var stream = new Blob([data]).stream().pipeThrough(ds);
    var ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
  }

  /**
   * unzipDocuments(zipFile) -> Promise<Array<{name, blob}>>
   * Resolves with the extractable document entries, or rejects with an
   * Error whose message is user-presentable.
   */
  async function unzipDocuments(zipFile) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("Your browser can't open ZIP files. Please upload the documents individually.");
    }
    var size = zipFile.size;
    if (size < 22) throw new Error("That ZIP file looks empty or corrupted.");

    // Find End of Central Directory in the last 64KB (+22).
    var tailLen = Math.min(size, 65558);
    var tail = await readBlob(zipFile, size - tailLen, tailLen);
    var eocdOff = -1;
    for (var i = tail.length - 22; i >= 0; i--) {
      if (tail[i] === 0x50 && tail[i + 1] === 0x4b && tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
        eocdOff = i;
        break;
      }
    }
    if (eocdOff < 0) throw new Error("That doesn't look like a valid ZIP file.");

    var eocd = dv(tail.buffer, tail.byteOffset + eocdOff, 22);
    var entryCount = readU16(eocd, 10);
    var cdSize = readU32(eocd, 12);
    var cdOffset = readU32(eocd, 16);
    if (entryCount === 0) throw new Error("That ZIP file is empty.");
    if (entryCount > MAX_ENTRIES) {
      throw new Error("That ZIP has too many files (max " + MAX_ENTRIES + "). Split it up and try again.");
    }
    if (cdOffset + cdSize > size) throw new Error("That ZIP file looks corrupted.");

    var cd = await readBlob(zipFile, cdOffset, cdSize);
    var entries = [];
    var off = 0;
    var totalUncompressed = 0;
    for (var n = 0; n < entryCount; n++) {
      if (off + 46 > cd.length) throw new Error("That ZIP file looks corrupted.");
      var cdh = dv(cd.buffer, cd.byteOffset + off, 46);
      if (!(cd[off] === 0x50 && cd[off + 1] === 0x4b && cd[off + 2] === 0x01 && cd[off + 3] === 0x02)) {
        throw new Error("That ZIP file looks corrupted.");
      }
      var flags = readU16(cdh, 8);
      var method = readU16(cdh, 10);
      var compSize = readU32(cdh, 20);
      var uncompSize = readU32(cdh, 24);
      var nameLen = readU16(cdh, 28);
      var extraLen = readU16(cdh, 30);
      var commentLen = readU16(cdh, 32);
      var localOff = readU32(cdh, 42);
      var nameBytes = cd.slice(off + 46, off + 46 + nameLen);
      var name = decodeName(nameBytes);
      off += 46 + nameLen + extraLen + commentLen;

      // Skip directories, encrypted entries, and anything weird.
      if (name.charAt(name.length - 1) === "/") continue;
      if (flags & 0x1) continue; // encrypted
      if (method !== 0 && method !== 8) continue;
      if (uncompSize === 0xffffffff || compSize === 0xffffffff) {
        throw new Error("That ZIP uses a format we can't open. Try re-saving it normally.");
      }
      if (uncompSize > MAX_ENTRY_BYTES) {
        throw new Error("A file inside that ZIP is larger than 25 MB.");
      }
      var ext = extOf(name);
      if (ext === ".zip") continue; // no nested archives
      if (!ALLOWED_EXT[ext]) continue; // only documents we process
      totalUncompressed += uncompSize;
      if (totalUncompressed > MAX_TOTAL_BYTES) {
        throw new Error("That ZIP expands to more than 100 MB. Split it up and try again.");
      }
      entries.push({ name: safeName(name), method: method, compSize: compSize, localOff: localOff, mime: ALLOWED_EXT[ext] });
    }

    if (entries.length === 0) {
      throw new Error("No PDF, JPG, or PNG documents found in that ZIP.");
    }

    // Extract each entry via its local file header.
    var out = [];
    for (var e = 0; e < entries.length; e++) {
      var en = entries[e];
      var lh = await readBlob(zipFile, en.localOff, 30);
      if (!(lh[0] === 0x50 && lh[1] === 0x4b && lh[2] === 0x03 && lh[3] === 0x04)) {
        throw new Error("That ZIP file looks corrupted.");
      }
      var lhv = dv(lh.buffer, lh.byteOffset, 30);
      var lNameLen = readU16(lhv, 26);
      var lExtraLen = readU16(lhv, 28);
      var dataOff = en.localOff + 30 + lNameLen + lExtraLen;
      var comp = await readBlob(zipFile, dataOff, en.compSize);
      var raw = en.method === 8 ? await inflateRaw(comp) : comp;
      out.push({ name: en.name, blob: new Blob([raw], { type: en.mime }) });
    }
    return out;
  }

  global.FFZip = { unzipDocuments: unzipDocuments, isZipName: function (n) {
    return String(n || "").toLowerCase().slice(-4) === ".zip";
  } };
})(typeof window !== "undefined" ? window : this);
