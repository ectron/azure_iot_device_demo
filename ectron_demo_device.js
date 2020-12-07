'use strict';

var clientFromConnectionString = require('azure-iot-device-mqtt').clientFromConnectionString;
var Client = require('azure-iot-device').Client;
var Message = require('azure-iot-device').Message;
var ConnectionString = require('azure-iot-device').ConnectionString;

var iotHubTransport = require('azure-iot-device-mqtt').Mqtt;
var ProvisioningTransport = require('azure-iot-provisioning-device-mqtt').Mqtt;
var SymmetricKeySecurityClient = require('azure-iot-security-symmetric-key').SymmetricKeySecurityClient;
var ProvisioningDeviceClient = require('azure-iot-provisioning-device').ProvisioningDeviceClient;

var provisioningHost = process.env.PROVISIONING_HOST;
var idScope = process.env.PROVISIONING_IDSCOPE;
var registrationId = process.env.PROVISIONING_REGISTRATION_ID;
var symmetricKey = process.env.PROVISIONING_SYMMETRIC_KEY;

var connectionString = 'HostName=iotc-d528f457-e479-4cee-a7d2-bc52c4b09be2.azure-devices.net;DeviceId=5a2de1de-ac70-4198-86ca-96e7d77569e0;SharedAccessKey=L3NRayjQqTf4BvV5QkEmQ2oLqaoSX1n7+yJ8VyGcgio=';
//var connectionString = 'HostName=rpi-iot-hu.azure-devices.net;DeviceId=rpi-test;SharedAccessKey=4oYYPsaC/BsTTQ8GdpcETFbOm6eMnrJvxage1/Kq2so=';
//var connectionString = 'HostName=iotc-d528f457-e479-4cee-a7d2-bc52c4b09be2.azure-devices.net;DeviceId=52691d03-b677-47c4-bc78-f4475d9c3d8d;SharedAccessKey=T4BL50WGkpOACuva0phI0tgGDm8HIFxGJ5yh+5y/brY=';
var targetTemperature = 0;
var FANMODE = "0";
var swFanmodeCnt = 0;

//  !!!code without DPS
//var client = clientFromConnectionString(connectionString);
var hubClient;

// Send device telemetry.
function sendTelemetry() {
  var temperature = targetTemperature + (Math.random() * 15);
  var data = JSON.stringify({ temperature: temperature, fanmode: FANMODE });
  var message = new Message(data);
  hubClient.sendEvent(message, (err, res) => console.log(`Sent message: ${message.getData()}` +
    (err ? `; error: ${err.toString()}` : '') +
    (res ? `; status: ${res.constructor.name}` : '')));

  if (Math.random()>0.95) {
    console.log(`Sending Fan motor Error event`);
    var err_data = JSON.stringify({ fanmotorerr: "fanerror" });
    var message = new Message(err_data);
    hubClient.sendEvent(message, (err, res) => console.log(`Sent message: ${message.getData()}` +
        (err ? `; error: ${err.toString()}` : '') +
        (res ? `; status: ${res.constructor.name}` : '')) )
  }

  swFanmodeCnt = swFanmodeCnt+1;
  if (swFanmodeCnt>24) {
    FANMODE = (FANMODE=="0") ? "1" : "0";
    swFanmodeCnt = 0;
  }
}

// Send device properties
function sendDeviceProperties(twin) {
  var properties = {
    firmwareVersion: "9.75",
    serialNumber: "10001" ,
    newTemperature: targetTemperature
  };
  twin.properties.reported.update(properties, (errorMessage) => 
  console.log(` * Sent device properties ` + JSON.stringify(properties) + (errorMessage ? ` Error: ${errorMessage.toString()}` : `(success)`)));
}

// Add any settings your device supports
// mapped to a function that is called when the setting is changed.
var settings = {
  'setTemperature': (newValue, callback) => {
    // Simulate the temperature setting taking two steps.
    setTimeout(() => {
      targetTemperature = targetTemperature + (newValue - targetTemperature) / 2;
      callback(targetTemperature, 'pending');
      setTimeout(() => {
        targetTemperature = newValue;
        callback(targetTemperature, 'completed');
      }, 5000);
    }, 5000);
  }
};

// Handle settings changes that come from Azure IoT Central via the device twin.
function handleSettings(twin) {
  console.log(`CALLED handleSettings()`);
  twin.on('properties.desired', function (desiredChange) {
    console.log(`CALLED twin update callback`);
    console.log(JSON.stringify(desiredChange));
    for (let setting in desiredChange) {
      if (settings[setting]) {
        console.log(`Received setting: ${setting}: ${desiredChange[setting]}`);
        settings[setting](desiredChange[setting], (newValue, status, message) => {
          /*var patch = {
            [setting]: {
              [setting]: newValue,
              status: status,
              desiredVersion: desiredChange.$version,
              message: message
            }
          }*/
          var patch = {
              [setting]: newValue
          }
          console.log(patch)
          twin.properties.reported.update(patch, (err) => console.log(`Sent setting update for ${setting}; ` +
            (err ? `error: ${err.toString()}` : `status: success`)));
          /*if (status=='completed')
              sendDeviceProperties(twin);*/
        });
      }
    }
  });
  console.log(`FINISHED handleSettings()`);
}

// Respond to the echo command
function onCommandEcho(request, response) {
  // Display console info
  console.log(' * Echo command received');
  // Respond
  response.send(200, 'Success', function (errorMessage) {});
}


// Handle device connection to Azure IoT Central.
var connectCallback = (err) => {
  if (err) {
    console.log(`Device could not connect to Azure IoT Central: ${err.toString()}`);
  } else {
    console.log('Device successfully connected to Azure IoT Central');
    // Send telemetry measurements to Azure IoT Central every 1 second.
    setInterval(sendTelemetry, 1000);

    // cloud to device message
    hubClient.on('message', function (msg) {
      console.log('C2D msg ----');
      console.log(msg.data.toString());
      console.log('C2D msg ----');

      hubClient.complete(msg, function (err) {
        if (err) {
          //hubClient.error('could not settle message: ' + err.toString());
          console.log('could not settle message: ' + err.toString());
        } else {
          console.log('message successfully accepted');
        }
      });
    });

    // Setup device command callbacks
    hubClient.onDeviceMethod('echo', onCommandEcho);
    // Get device twin from Azure IoT Central.
    console.log('Device twin: ',hubClient.getTwin());
    hubClient.getTwin((err, twin) => {
      if (err) {
        console.log(`Error getting device twin: ${err.toString()}`);
      } else {
        // Send device properties once on device start up
        console.log('BEFORE sendDeviceProperties()');
        sendDeviceProperties(twin);
        console.log('AFTER sendDeviceProperties()');
        // Apply device settings and handle changes to device settings.
        handleSettings(twin);
      }
    });
  }
};

var provisioningSecurityClient = new SymmetricKeySecurityClient(registrationId, symmetricKey);

var provisioningClient = ProvisioningDeviceClient.create(provisioningHost, idScope, new ProvisioningTransport(), provisioningSecurityClient);
// Register the device.
provisioningClient.setProvisioningPayload({a: 'b'});
provisioningClient.register(function(err, result) {
  if (err) {
    console.log("error registering device: " + err);
  } else {
    console.log('registration succeeded');
    console.log('assigned hub=' + result.assignedHub);
    console.log('deviceId=' + result.deviceId);
    console.log('payload=' + JSON.stringify(result.payload));
    var connectionString = 'HostName=' + result.assignedHub + ';DeviceId=' + result.deviceId + ';SharedAccessKey=' + symmetricKey;
    hubClient = Client.fromConnectionString(connectionString, iotHubTransport);
    hubClient.open(connectCallback);
  }
});

// !!!code without DPS
//client.open(connectCallback);
