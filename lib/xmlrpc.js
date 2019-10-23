var request = require('superagent');
var Serializer = require('./Serializer');
var Deserializer = require('./Deserializer');

function Client(url) {
    this.url = url;
}

var proto = Client.prototype;
proto.call = function(method, params, cb) {
    var xml = Serializer.serializeMethodCall(method, params, 'utf8');
    request
        .post(this.url)
        .set('Content-Type', 'text/plain;charset=UTF-8')
        .send(xml)
        .end(function(err, res) {
            if(err) return cb(err);
            new Deserializer('utf-8').deserializeMethodResponse(res.text, function(err, res) {
                if(err) return cb(err);
                cb(null, res);
            })
        });
};

module.exports = Client;
