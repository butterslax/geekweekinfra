#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { GeekweekinfraStack } from '../lib/geekweekinfra-stack';

const app = new cdk.App();
new GeekweekinfraStack(app, 'GeekweekinfraStack');
