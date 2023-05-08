# /*********************************************************************************************************************
# *  Copyright 2023 Amazon.com, Inc. or its affiliates. All Rights Reserved.                                           *
# *                                                                                                                    *
# *  Licensed under the Amazon Software License (the "License"). You may not use this file except in compliance        *
# *  with the License. A copy of the License is located at                                                             *
# *                                                                                                                    *
# *      http://aws.amazon.com/asl/                                                                                    *
# *                                                                                                                    *
# *  or in the "license" file accompanying this file. This file is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES *
# *  OR CONDITIONS OF ANY KIND, express or implied. See the License for the specific language governing permissions    *
# *  and limitations under the License.                                                                                *
# **********************************************************************************************************************/

import boto3
import json 
import sys

# Create Boto3 client for secretsmanager.
client = boto3.client('secretsmanager')

# Retrieve the secret value using the secret id passed in as the commandline argument.
response = client.get_secret_value(SecretId=sys.argv[1])
database_secrets = json.loads(response['SecretString'])

# Print the results to stdout.
print('export POSTGRES_USER=' + database_secrets['username'] + ' POSTGRES_PASSWORD=' + database_secrets['password'])
