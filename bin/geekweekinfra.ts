#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
//import { Aspects } from 'aws-cdk-lib';
//import { NIST80053R5Checks } from 'cdk-nag';
import { GeekweekinfraStack } from '../lib/geekweekinfra-stack';

const app = new cdk.App();
new GeekweekinfraStack(app, 'GeekweekinfraStack');
//Aspects.of(app).add(new NIST80053R5Checks());
