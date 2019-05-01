/*
 * Copyright 2016 Amazon.com, Inc. or its affiliates. All Rights Reserved.
 *
 * SPDX-License-Identifier: MIT-0
 */

var Promise = require('promise');
var Tags = require('./tags');

var ec2CreateTags;
var ec2DeleteTags;
var ec2DescribeClassicLinkInstances;
var ec2DescribeInstances;
var ec2AttachClassicLinkVpc;

// Given our set of Security Group pairs, ensures that any Classic EC2
// instances that are members of ClassicLink Mirror-managed Classic
// Security Groups get linked to the corresponding VPC Security Groups.

exports.init = function(ec2) {
    ec2CreateTags = Promise.denodeify(ec2.createTags).bind(ec2);
    ec2DeleteTags = Promise.denodeify(ec2.deleteTags).bind(ec2);
    ec2DescribeClassicLinkInstances = Promise.denodeify(ec2.describeClassicLinkInstances).bind(ec2);
    ec2DescribeInstances = Promise.denodeify(ec2.describeInstances).bind(ec2);
    ec2DetachClassicLinkVpc = Promise.denodeify(ec2.detachClassicLinkVpc).bind(ec2);
    ec2AttachClassicLinkVpc = Promise.denodeify(ec2.attachClassicLinkVpc).bind(ec2);
};

// Returns a Promise whose result is a structure of the ClassicLink
// operations that were attempted.
exports.linkInstances = function(securityGroupPairs, callback) {

    var instanceLinkTasks = [];

    // Prepare arrays of Classic and VPC Security Group IDs, as well as a
    // map for ClassicSgId --> VpcSg.
    // These will make the below steps easier.
    var classicGroupIds = [];
    var vpcGroupIds = [];
    var classicToVpcGroupMap = {};
    securityGroupPairs.forEach(function(pair) {
        if (pair.classicSecurityGroup && pair.vpcSecurityGroup) {
            classicGroupIds.push(pair.classicSecurityGroup.GroupId);
            vpcGroupIds.push(pair.vpcSecurityGroup.GroupId);
            classicToVpcGroupMap[pair.classicSecurityGroup.GroupId] = pair.vpcSecurityGroup;
        }
    });

    // To determine the work that needs to be done:
    // * Describe all instances that are members of any of our Classic
    //   Security Groups.
    // * Describe all instances that are already linked to any of our
    //   VPC Security Groups.
    // * Any instance that has a discrepancy needs to be unlinked and
    //   then relinked to the correct set.  This is because Security
    //   Groups cannot be modified without unlinking the instance.

    var classicInstanceMap = {};
    var linkedInstanceMap = {};

    var describeInstancesParams = {
        Filters: [
            { Name: 'group-id', Values: classicGroupIds },
            { Name: 'instance-state-name', Values: ['running'] }
        ]
    };
    return ec2DescribeInstances(describeInstancesParams).then(function(data) {
        // Build instanceId-->instance map for these Classic instances
        // from the DescribeInstances response
        data.Reservations.forEach(function(reservation) {
            reservation.Instances.forEach(function(instance) {
                classicInstanceMap[instance.InstanceId] = instance;
            });
        });
        console.log('LinkInstances: Classic instances: ' + JSON.stringify(Object.keys(classicInstanceMap).sort()));

        // Describe instances ClassicLinked to our set of
        // ClassicLink Mirror-managed VPC Security Groups.
        // This function takes care of the fact that
        // EC2.DescribeClassicLinkInstances returns paginated responses.
        return _describeClassicLinkInstancesPromise(vpcGroupIds, [])
    }).then(function(data) {
        // Build instanceId-->instanceClassicLink map for the Classic
        // instances that are already ClassicLinked
        data.forEach(function(instanceClassicLink) {
            linkedInstanceMap[instanceClassicLink.InstanceId] = instanceClassicLink;
        });

        // Determine which Classic instances need us to take action.
        // Only these will end up in instanceLinkTasks.
        instanceLinkTasks = _prepareInstanceLinkTasks(classicInstanceMap, linkedInstanceMap, classicToVpcGroupMap);

        var promises = instanceLinkTasks.map(function(task) {
            // Each of these Promises will resolve successfully even if
            // the operation fails.  In case of failure, the task will
            // be marked with the 'error' property, which we will handle
            // below.
            return _linkInstancePromise(task);
        });
        return Promise.all(promises);
    }).catch(function(err) {
        console.error('LinkInstances: Failure to describe instances: ' + err);
        return Promise.resolve(instanceLinkTasks);
    }).then(function() {
        return Promise.resolve(instanceLinkTasks);
    }).nodeify(callback);
};

// Handles the paginated response from DescribeClassicLinkInstances
function _describeClassicLinkInstancesPromise(vpcGroupIds, instances, nextToken) {
    var describeClassicLinkInstancesParams = {
        Filters: [ { Name: 'group-id', Values: vpcGroupIds } ],
        NextToken: nextToken
    };
    return ec2DescribeClassicLinkInstances(describeClassicLinkInstancesParams).then(function(data) {
        // Add the results to 'instances', where we are accumulating all
        // the pages.
        data.Instances.forEach(function(instance) {
            instances.push(instance);
        });

        if (data.NextToken) {
            // There is more to the response: Call ourselves again.
            return _describeClassicLinkInstancesPromise(vpcGroupIds, instances, data.NextToken);
        } else {
            // The response is complete; we can return.
            return Promise.resolve(instances);
        }
    });
}

// Given maps of ClassicLink Mirror-managed Classic instances and the set
// of Classic instances currently linked to ClassicLink Mirror-managed VPC
// Security Groups, determine what ClassicLink operations neeed to be
// done.
function _prepareInstanceLinkTasks(classicInstanceMap, linkedInstanceMap, classicToVpcGroupMap) {
    var tasks = [];
    for (var classicInstanceId in classicInstanceMap) {

        var task = {
            instanceId: classicInstanceId,
            linkToVpcId: undefined,
            linkToVpcSecurityGroupIds: [],
            existingLinkedVpcId: undefined
        };

        var classicInstance = classicInstanceMap[classicInstanceId];
        var instanceSecurityGroups = classicInstance.SecurityGroups.map(function(group) {
            return group.GroupId;
        });

        // Determine which VPC Security Groups this should be linked to.
        // We also check here whether they're trying to link us to two
        // different VPCs, which we cannot do, so we'll skip it if that
        // happens.
        var desiredVpcSecurityGroups = [];
        var err = undefined;
        instanceSecurityGroups.forEach(function(classicSgId) {
            var vpcSg = classicToVpcGroupMap[classicSgId];
            if (vpcSg) {
                if (task.linkToVpcId && (task.linkToVpcId != vpcSg.VpcId)) {
                    console.warn('LinkInstances: Warning: Instance ' + classicInstance.InstanceId + ' has Security Groups that try to link to multiple VPCs: ' + task.linkToVpcId + ',' + vpcSg.VpcId + '; skipping');
                    err = true;
                }
                task.linkToVpcId = vpcSg.VpcId;
                desiredVpcSecurityGroups.push(vpcSg);
            }
            // else this Classic Security Group is not one we're trying
            // to link.
        });
        if (err) continue;

        var desiredVpcSecurityGroupIds = desiredVpcSecurityGroups.map(function(group) {
            return group.GroupId;
        }).sort();

        // Determine which VPC Security Groups this is actually linked to.
        var actualVpcSecurityGroupIds = [];
        var instanceClassicLink = linkedInstanceMap[classicInstanceId];
        if (instanceClassicLink) {
            task.existingLinkedVpcId = instanceClassicLink.VpcId;
            task.hasExistingLink = true;
            actualVpcSecurityGroupIds = instanceClassicLink.Groups.map(function(group) {
                return group.GroupId;
            }).sort();
        }

        // If the set of ClassicLinked Security Groups already exactly
        // matches what we want, then we are already in sync and nothing
        // needs to be done.
        var alreadyInSync = false;
        if (desiredVpcSecurityGroupIds.length == actualVpcSecurityGroupIds.length) {
            alreadyInSync = true;
            for (var i = 0; alreadyInSync && (i < desiredVpcSecurityGroupIds.length); i++) {
                alreadyInSync = (desiredVpcSecurityGroupIds[i] == actualVpcSecurityGroupIds[i]);
            }
        }

        if (alreadyInSync) {
            console.log('LinkInstances: Instance ' + classicInstanceId + ' already linked to the right Security Groups ' + JSON.stringify(desiredVpcSecurityGroupIds) + '; no action');
        } else {
            task.linkToVpcSecurityGroupIds = desiredVpcSecurityGroupIds;
            console.log('LinkInstances: Prepare to ClassicLink instance ' + classicInstanceId + ': was linked to ' + JSON.stringify(actualVpcSecurityGroupIds) + '; will link to ' + JSON.stringify(task.linkToVpcSecurityGroupIds) + ' in ' + task.linkToVpcId);
            tasks.push(task);
        }
    }
    return tasks;
}

// 1. If already linked, unlink; this is because ClassicLink requires
//    this in order to change the set of Linked Security Groups
// 2. Link
// 3. Tag the instance
function _linkInstancePromise(task) {
    // Unlink if necessary
    var unlinkPromise = Promise.resolve(null);
    if (task.existingLinkedVpcId) {
        console.log('LinkInstances: UNLINK ' + task.instanceId + ' from ' + task.existingLinkedVpcId);
        unlinkPromise = ec2DetachClassicLinkVpc({
            InstanceId: task.instanceId,
            VpcId: task.existingLinkedVpcId
        });
    }
    return unlinkPromise.then(function() {
        // Link
        console.log('LinkInstances: LINK ' + task.instanceId + ' to ' + task.linkToVpcId + ': ' + JSON.stringify(task.linkToVpcSecurityGroupIds));
        var linkPromise = Promise.resolve(null);
        if (task.linkToVpcSecurityGroupIds.length > 0) {
            linkPromise = ec2AttachClassicLinkVpc({
                InstanceId: task.instanceId,
                VpcId: task.linkToVpcId,
                Groups: task.linkToVpcSecurityGroupIds
            });
        }
        return linkPromise;
    }).then(function() {
        // Getting here means the Unlink/Link worked, so delete any
        // LastUpdateError tag that was there.
        var tagParams = {
            Resources: [ task.instanceId ],
            Tags: [ { Key: Tags.LAST_ERROR_TAG_KEY } ]
        };
        return ec2DeleteTags(tagParams);
    }).catch(function(err) {
        // Getting here means that the Unlink/Link was unsuccessful;
        // add a LastUpdateError tag.
        console.error('LinkInstances: Error linking ' + JSON.stringify(task) + ': ' + err);
        task.error = err;
        return ec2CreateTags({
            Resources: [ task.instanceId ],
            Tags: [ {
                Key: Tags.LAST_ERROR_TAG_KEY,
                Value: Tags.lastErrorTagValue(err)
            } ]
        });
    }).then(function(data) {
        // In any case, tag the instance with a LastUpdatedTime
        var now = new Date();
        return ec2CreateTags({
            Resources: [ task.instanceId ],
            Tags: [ {
                Key: Tags.UPDATE_TIMESTAMP_TAG_KEY,
                Value: now.toISOString()
            } ]
        });
    }).then(function() {
        return Promise.resolve(task);
    }).catch(function(err) {
        console.error('LinkInstances: Error tagging ' + task.instanceId + ': ' + err);
        return Promise.resolve(task);
    });
}


