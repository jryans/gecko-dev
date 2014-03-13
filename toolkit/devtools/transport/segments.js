/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Segments contain read / write functionality for low-level parts of a packet
 * in the debugging protocol.  The packets use various combinations of these to
 * support parse and serializing data in a given format.
 *
 * They are intended to be "one use only", so a new segment should be
 * instantiated for each incoming or outgoing packet.
 *
 * A complete Segment type should expose at least the following:
 *   * read(stream):  Called when the input stream has data to read
 *   * write(stream): Called when the output stream is ready to write
 *   * get done():    Returns true once the segment is done being read / written
 *   * destroy():     Called to clean up at the end of use
 */

function StringSegment(data) {
  this.data = data || "";
}

StringSegment.prototype = {

  write: function(stream) {
    dumpv(() => "Writing a string segment");
    let written = stream.write(this.data, this.data.length);
    this.data = this.data.slice(written);
    this.done = !this.data.length;
  },

  read: function(stream, fullLength) {
    dumpv(() => "Reading a string segment: fL: " + fullLength + " dL: " +
          this.data.length + " sA: " + stream.available());
    let bytesToRead = Math.min(fullLength - this.data.length,
                               stream.available());
    this.data += NetUtil.readInputStreamToString(stream, bytesToRead);
    this.done = this.data.length === fullLength;
  },

  destroy: function() {}

};

this.StringSegment = StringSegment;

function DelimitedSegment(delimeter) {
  this._delimiter = delimeter;
  this.data = "";
  this.limit = 0;
  this.count = 0;
}

DelimitedSegment.prototype = {

  write: function(stream) {
    dumpv(() => "Writing a delimited segment");

    // Merge the delimiter with data for simplicity
    if (this._delimiter) {
      this.data += this._delimiter;
      this._delimiter = null;
    }

    let written = stream.write(this.data, this.data.length);
    this.data = this.data.slice(written);
    this.done = !this.data.length;
  },

  /**
   * If some data has already been pulled off the stream that may contain the
   * delimiter (and we can't seek back), we start looking in that data before
   * reading the stream.
   * @return String Left over initial data after the delimiter (if any)
   */
  readInitial: function(initialData) {
    dumpv(() => "Examining initial data for " + this._delimiter);

    if (!initialData.length) {
      return "";
    }

    let delimeterPosition = initialData.indexOf(this._delimiter);
    if (delimeterPosition < 0) {
      // Not found yet, absorb all the initial data
      this.data = initialData;
      this.count = initialData.length;
      return "";
    }

    // Found delimiter
    dumpv(() => "Found matching " + this._delimiter);
    this.data = initialData.substring(0, delimeterPosition);
    this.count = delimeterPosition;
    this.done = true;
    return initialData.substring(delimeterPosition + 1);
  },

  read: function(stream) {
    dumpv(() => "Reading delimited segment, looking for " + this._delimiter);

    if (this.done) {
      dumpv(() => "Found matching " + this._delimiter);
      return;
    }

    this._checkReadLimit();
    let char = NetUtil.readInputStreamToString(stream, 1);
    this.count++;
    while (char !== this._delimiter) {
      this.data += char;
      if (!stream.available()) {
        break;
      }
      this._checkReadLimit();
      char = NetUtil.readInputStreamToString(stream, 1);
      this.count++;
    }
    this.done = char === this._delimiter;

    if (this.done) {
      dumpv(() => "Found matching " + this._delimiter);
    }
  },

  _checkReadLimit: function() {
    if (this.limit > 0 && this.count >= this.limit) {
      throw new Error("Failed to find " + this._delimiter + " before limit.");
    }
  },

  destroy: function() {}

};

this.DelimitedSegment = DelimitedSegment;

function StreamSegment(packet) {
  this._packet = packet;
  this._transport = packet._transport;
}

StreamSegment.prototype = {

  /**
   * This is called when the transport is ready for this segment to write.
   * In the case of StreamSegment, the output stream is handed off to someone
   * else to temporarily take control and write to the stream directly.
   */
  write: function(stream) {
    dumpv(() => "Handing off output stream");

    // Temporarily pause the monitoring of the output stream
    this._transport.pauseOutgoing();

    let deferred = defer();

    this._readyForWriting.resolve({
      copyFrom: (input) => {
        deferred.resolve(copyStream(input, stream, this.length));
        return deferred.promise;
      },
      stream: stream,
      done: deferred
    });

    // Await the result of writing to the stream
    deferred.promise.then(() => {
      dumpv(() => "onWriteDone called, ending bulk mode");
      this.done = true;
      this._transport.resumeOutgoing();
    }, this._transport.close);

    // Ensure this is only done once
    this.write = () => {
      throw new Error("Tried to write() a StreamSegment multiple times.");
    };
  },

  get readyForWriting() {
    if (!this._readyForWriting) {
      this._readyForWriting = defer();
    }
    return this._readyForWriting.promise;
  },

  /**
   * This is called when the transport is ready for this segment to be read.
   * In the case of StreamSegment, the input stream is handed off to someone
   * else to temporarily take control and read from the stream directly.
   */
  read: function(stream) {
    dumpv(() => "Handing off input stream");

    // Temporarily pause monitoring of the input stream
    this._transport.pauseIncoming();

    let deferred = defer();

    this._transport._onBulkReadReady({
      actor: this._packet.actor,
      type: this._packet.type,
      length: this._packet.length,
      copyTo: (output) => {
        deferred.resolve(copyStream(stream, output, this._packet.length));
        return deferred.promise;
      },
      stream: stream,
      done: deferred
    });

    // Await the result of reading from the stream
    deferred.promise.then(() => {
      dumpv(() => "onReadDone called, ending bulk mode");
      this.done = true;
      this._transport.resumeIncoming();
    }, this._transport.close);

    // Ensure this is only done once
    this.read = () => {
      throw new Error("Tried to read() a StreamSegment multiple times.");
    };
  },

  destroy: function() {
    this._packet = null;
    this._transport = null;
  }

};

this.StreamSegment = StreamSegment;
