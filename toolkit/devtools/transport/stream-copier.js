/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const BUFFER_SIZE = 0x8000;

let ioUtils = Cc["@mozilla.org/io-util;1"].getService(Ci.nsIIOUtil);

/**
 * This helper function (and its companion object) are used by bulk senders and
 * receivers to read and write data in and out of other streams.  Functions that
 * make use of this tool are passed to callers when it is time to read or write
 * bulk data.  It is highly recommended to use these copier functions instead of
 * the stream directly because the copier enforces the agreed upon length.
 * Since bulk mode reuses an existing stream, the sender and receiver must write
 * and read exactly the agreed upon amount of data, or else the entire transport
 * will be left in a invalid state.  Additionally, other methods of stream
 * copying (such as NetUtil.asyncCopy) close the streams involved, which would
 * terminate the debugging transport, and so it is avoided here.
 *
 * Overall, this *works*, but clearly the optimal solution would be able to just
 * use the streams directly.  If it were possible to fully implement
 * nsIInputStream / nsIOutputStream in JS, wrapper streams could be created to
 * enforce the length and avoid closing, and consumers could use familiar stream
 * utilities like NetUtil.asyncCopy.
 *
 * The function takes two async streams and copies a precise number of bytes
 * from one to the other.  Copying begins immediately, but may complete at some
 * future time depending on data size.  Use the returned promise to know when
 * it's complete.
 *
 * @param input nsIAsyncInputStream
 *        The stream to copy from.
 * @param output nsIAsyncOutputStream
 *        The stream to copy to.
 * @param length Integer
 *        The amount of data that needs to be copied.
 * @return Promise
 *         The promise is resolved when copying completes or rejected if any
 *         (unexpected) errors occur.
 */
function copyStream(input, output, length) {
  let copier = new StreamCopier(input, output, length);
  return copier.copy();
}
this.copyStream = copyStream;

function StreamCopier(input, output, length) {
  this.input = input;
  if (ioUtils.outputStreamIsBuffered(output)) {
    this.output = output;
  } else {
    this.output = Cc["@mozilla.org/network/buffered-output-stream;1"].
                  createInstance(Ci.nsIBufferedOutputStream);
    this.output.init(output, BUFFER_SIZE);
  }
  this.amountLeft = length;
  this._deferred = defer();
}

StreamCopier.prototype = {

  get copied() { return this._deferred.promise; },

  copy: function() {
    try {
      this._copy();
    } catch(e) {
      this._deferred.reject(e);
    }
    return this.copied;
  },

  _copy: function() {
    let bytesAvailable = this.input.available();
    let amountToCopy = Math.min(bytesAvailable, this.amountLeft);
    dumpv(() => "Trying to copy: " + amountToCopy);

    let bytesCopied;
    try {
      bytesCopied = this.output.writeFrom(this.input, amountToCopy);
    } catch(e if e.result == Cr.NS_BASE_STREAM_WOULD_BLOCK) {
      // Some data may still have been copied, let's try to find out.
      bytesCopied = bytesAvailable - this.input.available();
      this.amountLeft -= bytesCopied;
      dumpv(() => "Copied: " + bytesCopied + ", Left: " + this.amountLeft);
      dumpv(() => "Waiting for output stream");
      let threadManager = Cc["@mozilla.org/thread-manager;1"].getService();
      this.output.asyncWait(this, 0, 0, threadManager.currentThread);
      return;
    }

    this.amountLeft -= bytesCopied;
    dumpv(() => "Copied: " + bytesCopied + ", Left: " + this.amountLeft);

    if (this.amountLeft === 0) {
      dumpv(() => "Copy done!");
      this.output.flush();
      this._deferred.resolve();
      return;
    }

    dumpv(() => "Waiting for input stream");
    let threadManager = Cc["@mozilla.org/thread-manager;1"].getService();
    this.input.asyncWait(this, 0, 0, threadManager.currentThread);
  },

  // nsIInputStreamCallback
  onInputStreamReady: function() {
    this.copy();
  },

  // nsIOutputStreamCallback
  onOutputStreamReady: function() {
    this.copy();
  }

};
