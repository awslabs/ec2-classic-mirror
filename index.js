/*
 * Copyright 2016 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * SPDX-License-Identifier: MIT-0
 */

var AWS = require('aws-sdk');
var Promise = require('promise');
var cloudWatchEventFilter = require('./lib/cloudwatch_event_filter.js');
var describeSecurityGroups = require('./lib/describe_security_groups.js');
var createSecurityGroups = require('./lib/create_security_groups.js');
var cleanupOrphanedSecurityGroups = require('./lib/cleanup_orphaned_security_groups.js');
var syncSecurityGroupRules = require('./lib/sync_security_group_rules.js');
var linkInstances = require('./lib/link_instances.js');

exports.handler = function(event, context) {

    console.log('EVENT ' + JSON.stringify(event, null, 2));
    console.log('CONTEXT ' + JSON.stringify(context, null, 2));

    // Set up the AWS service clients
    AWS.config.region = event.region;
    var ec2 = new AWS.EC2();
    var lambda = new AWS.Lambda();
    cloudWatchEventFilter.init(lambda);
    describeSecurityGroups.init(ec2);
    createSecurityGroups.init(ec2);
    cleanupOrphanedSecurityGroups.init(ec2);
    syncSecurityGroupRules.init(ec2);
    linkInstances.init(ec2);


    cloudWatchEventFilter.filterCloudWatchEvent(event, context.invokedFunctionArn)
        .then(function(result) {
            if (result.isRelevant) {
                runClassicLinkMirrorWorkflow(context);
            } else {
                console.log('Event not relevant');
                context.succeed(null);
            }
        });
};

function runClassicLinkMirrorWorkflow(context) {

    var errors = [];

    describeSecurityGroups.describeSecurityGroupPairs()
        .then(createSecurityGroups.createVpcMirroredSecurityGroups)
        .then(cleanupOrphanedSecurityGroups.cleanupOrphanedVpcMirroredSecurityGroups)
        .then(syncSecurityGroupRules.syncSecurityGroupRules)
        .then(function(pairs) {
            // Collect errors but keep going.
            errors = errors.concat(extractErrors(pairs));
            return Promise.resolve(pairs);
        }).then(linkInstances.linkInstances)
        .then(function(linkInstanceTasks) {
            errors = errors.concat(extractErrors(linkInstanceTasks));
            if (errors.length > 0) {
                console.error('FAIL: ' + errors.length + ' errors');
                context.fail(errors);
            } else {
                context.succeed(null);
            }
        }).catch(function(err) {
            console.error('FAIL ' + JSON.stringify(err));
            context.fail(err);
        });
};

function extractErrors(arr) {
    return arr.filter(function(e) { return e.error; })
        .map(function(e) { return e.error; });
}
