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

echo DB_SECRET_NAME $DB_SECRET_NAME
echo POSTGRES_HOST $POSTGRES_HOST
echo POSTGRES_PORT $POSTGRES_PORT
echo POSTGRES_DB $POSTGRES_DB

# Run Boto3 script to fetch the database secrets, and evaliuate the stdout to set the variables POSTGRES_USER and POSTGRES_PASSWORD.
$(python get_secret.py $DB_SECRET_NAME)

# Initialize the labeling tool.
export DATABASE_URL="postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@${POSTGRES_HOST}:${POSTGRES_PORT}/${POSTGRES_DB}?sslmode=disable"

doccano init
doccano createuser --username admin --password pass # Replace the username and password.

# Start the labeling tool.
doccano task &  #https://github.com/doccano/doccano/issues/1353
doccano webserver --port 8000