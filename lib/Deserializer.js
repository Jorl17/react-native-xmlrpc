var
  htmlparser = require('htmlparser2-without-node-native'),
  dateFormatter = require('./date_formatter')

var Deserializer = function(encoding) {
  this.type = null
  this.responseType = null
  this.stack = []
  this.marks = []
  this.data = []
  this.methodname = null
  this.encoding = encoding || 'utf8'
  this.value = false
  this.callback = null
  this.error = null

  this.parser = new htmlparser.Parser({
      onopentag: this.onOpentag.bind(this),
      onclosetag: this.onClosetag.bind(this),
      ontext:     this.onText.bind(this),
      oncdata:    this.onCDATA.bind(this),
      onend:      this.onDone.bind(this),
      onerror:    this.onError.bind(this),
  })
}

Deserializer.prototype.deserializeMethodResponse = function(xml, callback) {
  var that = this

  this.callback = function(error, result) {
    if (error) {
      callback(error)
    }
    else if (result.length > 1) {
      callback(new Error('Response has more than one param'))
    }
    else if (that.type !== 'methodresponse') {
      callback(new Error('Not a method response'))
    }
    else if (!that.responseType) {
      callback(new Error('Invalid method response'))
    }
    else {
      callback(null, result[0])
    }
  }

  this.parser.write(xml);
  this.parser.end();
}

Deserializer.prototype.deserializeMethodCall = function(stream, callback) {
  var that = this

  this.callback = function(error, result) {
    if (error) {
      callback(error)
    }
    else if (that.type !== 'methodcall') {
      callback(new Error('Not a method call'))
    }
    else if (!that.methodname) {
      callback(new Error('Method call did not contain a method name'))
    }
    else {
      callback(null, that.methodname, result)
    }
  }

  this.parser.write(xml);
  this.parser.end();
}

Deserializer.prototype.onDone = function() {
  var that = this

  if (!this.error) {
    if (this.type === null || this.marks.length) {
      this.callback(new Error('Invalid XML-RPC message'))
    }
    else if (this.responseType === 'fault') {
      var createFault = function(fault) {
        var error = new Error('XML-RPC fault' + (fault.faultString ? ': ' + fault.faultString : ''))
        error.code = fault.faultCode
        error.faultCode = fault.faultCode
        error.faultString = fault.faultString
        return error
      }
      this.callback(createFault(this.stack[0]))
    }
    else {
      this.callback(undefined, this.stack)
    }
  }
}

// TODO:
// Error handling needs a little thinking. There are two different kinds of
// errors:
//   1. Low level errors like network, stream or xml errors. These don't
//      require special treatment. They only need to be forwarded. The IO
//      is already stopped in these cases.
//   2. Protocol errors: Invalid tags, invalid values &c. These happen in
//      our code and we should tear down the IO and stop parsing.
// Currently all errors end here. Guess I'll split it up.
Deserializer.prototype.onError = function(msg) {
  if (!this.error) {
    if (typeof msg === 'string') {
      this.error = new Error(msg)
    }
    else {
      this.error = msg
    }
    this.callback(this.error)
  }
}

Deserializer.prototype.push = function(value) {
  this.stack.push(value)
}

//==============================================================================
// SAX Handlers
//==============================================================================

Deserializer.prototype.onOpentag = function(node) {
  if (node === 'array' || node === 'struct') {
    this.marks.push(this.stack.length)
  }
  this.data = []
  this.value = (node === 'value')
}

Deserializer.prototype.onText = function(text) {
  this.data.push(text)
}

Deserializer.prototype.onCDATA = function(cdata) {
  this.data.push(cdata)
}

Deserializer.prototype.onClosetag = function(el) {
  var data = this.data.join('')
  try {
    switch(el) {
      case 'boolean':
        this.endBoolean(data)
        break
      case 'int':
      case 'i4':
        this.endInt(data)
        break
      case 'i8':
        this.endI8(data)
        break
      case 'double':
        this.endDouble(data)
        break
      case 'string':
      case 'name':
        this.endString(data)
        break
      case 'array':
        this.endArray(data)
        break
      case 'struct':
        this.endStruct(data)
        break
      case 'base64':
        this.endBase64(data)
        break
      case 'datetime.iso8601':
        this.endDateTime(data)
        break
      case 'value':
        this.endValue(data)
        break
      case 'params':
        this.endParams(data)
        break
      case 'fault':
        this.endFault(data)
        break
      case 'methodresponse':
        this.endMethodResponse(data)
        break
      case 'methodname':
        this.endMethodName(data)
        break
      case 'methodcall':
        this.endMethodCall(data)
        break
      case 'nil':
        this.endNil(data)
        break
      case 'data':
      case 'param':
      case 'member':
        // Ignored by design
        break
      default:
        this.onError('Unknown XML-RPC tag \'' + el + '\'')
        break
    }
  }
  catch (e) {
    this.onError(e)
  }
}

Deserializer.prototype.endNil = function(data) {
  this.push(null)
  this.value = false
}

Deserializer.prototype.endBoolean = function(data) {
  if (data === '1') {
    this.push(true)
  }
  else if (data === '0') {
    this.push(false)
  }
  else {
    throw new Error('Illegal boolean value \'' + data + '\'')
  }
  this.value = false
}

Deserializer.prototype.endInt = function(data) {
  var value = parseInt(data, 10)
  if (isNaN(value)) {
    throw new Error('Expected an integer but got \'' + data + '\'')
  }
  else {
    this.push(value)
    this.value = false
  }
}

Deserializer.prototype.endDouble = function(data) {
  var value = parseFloat(data)
  if (isNaN(value)) {
    throw new Error('Expected a double but got \'' + data + '\'')
  }
  else {
    this.push(value)
    this.value = false
  }
}

Deserializer.prototype.endString = function(data) {
  this.push(data)
  this.value = false
}

Deserializer.prototype.endArray = function(data) {
  var mark = this.marks.pop()
  this.stack.splice(mark, this.stack.length - mark, this.stack.slice(mark))
  this.value = false
}

Deserializer.prototype.endStruct = function(data) {
  var mark = this.marks.pop()
    , struct = {}
    , items = this.stack.slice(mark)
    , i = 0

  for (; i < items.length; i += 2) {
    struct[items[i]] = items[i + 1]
  }
  this.stack.splice(mark, this.stack.length - mark, struct)
  this.value = false
}

Deserializer.prototype.endBase64 = function(data) {
  var buffer = new Buffer(data, 'base64')
  this.push(buffer)
  this.value = false
}

Deserializer.prototype.endDateTime = function(data) {
  var date = dateFormatter.decodeIso8601(data)
  this.push(date)
  this.value = false
}

var isInteger = /^-?\d+$/
Deserializer.prototype.endI8 = function(data) {
  if (!isInteger.test(data)) {
    throw new Error('Expected integer (I8) value but got \'' + data + '\'')
  }
  else {
    this.endString(data)
  }
}

Deserializer.prototype.endValue = function(data) {
  if (this.value) {
    this.endString(data)
  }
}

Deserializer.prototype.endParams = function(data) {
  this.responseType = 'params'
}

Deserializer.prototype.endFault = function(data) {
  this.responseType = 'fault'
}

Deserializer.prototype.endMethodResponse = function(data) {
  this.type = 'methodresponse'
}

Deserializer.prototype.endMethodName = function(data) {
  this.methodname = data
}

Deserializer.prototype.endMethodCall = function(data) {
  this.type = 'methodcall'
}

module.exports = Deserializer
