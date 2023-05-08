/*********************************************************************************************************************
*  Copyright 2023 Amazon.com, Inc. or its affiliates. All Rights Reserved.                                           *
*                                                                                                                    *
*  Licensed under the Amazon Software License (the "License"). You may not use this file except in compliance        *
*  with the License. A copy of the License is located at                                                             *
*                                                                                                                    *
*      http://aws.amazon.com/asl/                                                                                    *
*                                                                                                                    *
*  or in the "license" file accompanying this file. This file is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES *
*  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions    *
*  and limitations under the License.                                                                                *
**********************************************************************************************************************/

const AWS = require('aws-sdk')
const { Client } = require('pg');

// Create a SecretsManager client instance.
const secrets = new AWS.SecretsManager({})

exports.handler = async (e) => {
    console.log('EVENT', e)

    // Nothing to do if the callback was not for onCreate.
    if (e.params.action !== 'onCreate') {
        console.log('Nothing to do.')

        return {
            status: 'OK',
            results: 'Skip'
        }
    }

    try {
        // Get the database secrets.
        const { secretName, databaseName } = e.params
        const { password, username, host, port } = await getSecretValue(secretName)

        // Create a PostgreSQL client with pg.
        const client = new Client({
            host: host,
            user: username,
            password: password,
            port: 5432,
        });

        // Connect to the cluster and create a database in the cluster.
        await client.connect();
        await client.query('CREATE DATABASE ' + databaseName);
        await client.end();

        // Return success result.
        return {
            status: 'OK',
            results: 'res' + password + ' , ' + username + ' , ' + host + ' , ' + port
        }
    } catch (err) {
        console.log('err', err)

        // Return error result.
        return {
            status: 'ERROR',
            err,
            message: err.message
        }
    }
}

// Helper function to get a Promise to fetch a SecretValue.
function getSecretValue(secretId) {
    return new Promise((resolve, reject) => {
        secrets.getSecretValue({ SecretId: secretId }, (err, data) => {
            if (err) {
                return reject(err);
            }

            return resolve(JSON.parse(data.SecretString))
        })
    })
}