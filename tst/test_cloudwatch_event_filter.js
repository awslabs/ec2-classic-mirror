/*
 * Copyright 2016 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * SPDX-License-Identifier: MIT-0
 */

var cloudWatchEventFilter = require('../lib/cloudwatch_event_filter.js');
var LambdaMock = require('./lambdamock.js');

exports.setUp = function(callback) {
    cloudWatchEventFilter.init(new LambdaMock());
    callback();
};

function filterCloudWatchEventTest(testEvent, expected, test) {
    var functionArn = 'arn:aws:lambda:us-east-1:111122223333:function:MyFunctionName';
    cloudWatchEventFilter.filterCloudWatchEvent(testEvent, functionArn, function(err, result) {
        test.ok(!err);
        test.equal(result.isRelevant, expected, 'Unexpected result ' + result + ' for ' + JSON.stringify(testEvent));
        test.done();
    });
}

function filterCloudWatchEventTestFile(eventContentFile, expected, test) {
    filterCloudWatchEventTest(require(eventContentFile), expected, test);
}

exports.cloudWatchEventFilterGroup = {
    // Call with null event should be ignored
    nullEvent: function(test) {
        filterCloudWatchEventTest(null, false, test);
    },

    unrecognizedEvent: function(test) {
        filterCloudWatchEventTest({foo: 3, bar: 9}, false, test);
    },

    // Call to AuthorizeSecurityGroupIngress
    relevantAuthorizeCall: function(test) {
       filterCloudWatchEventTestFile('./cloudwatch_event_authorizesecuritygroupingress_cidr.json', true, test);
    },

    // Call to AuthorizeSecurityGroupIngress from our own IAM role should
    // be ignored
    irrelevantSameRoleCall: function(test) {
        filterCloudWatchEventTestFile('./cloudwatch_event_authorizesecuritygroupingress_assumedrole.json', false, test);
    },

    // Call to CreateTags for a classiclinkmirror tag
    relevantCreateTagsCall: function(test) {
        filterCloudWatchEventTestFile('./cloudwatch_event_create_tags.json', true, test);
    },

    // Call to CreateTags for some other tag should be ignored
    irrelevantCreateTagsCall: function(test) {
        filterCloudWatchEventTestFile('./cloudwatch_event_create_tags_other.json', false, test);
    },

    // Failed call should be ignored
    irrelevantFailedCall: function(test) {
        filterCloudWatchEventTestFile('./cloudwatch_event_create_tags_failed.json', false, test);
    },

    // Instance went into running state
    instanceRunningState: function(test) {
        filterCloudWatchEventTestFile('./cloudwatch_event_instance_running.json', true, test);
    }

};

