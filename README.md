# SaaS LEGO Tracker

This project is for working with different SaaS ideas within AWS (primarily in the Serverless space).

## Current ideas:

### Use Step Functions to allow direct (non-Lambda) service integrations with AppSync while still supporting data isolation strategies.

Status: In progress

Known limitations: Requires a role per tenant

Outstanding work: - Implement a real authorizer - Use `esbuild` to generate the AppSync functions so we can bundle in DynamoDB unmarshalling to simplify output.

### Framework for multiple account control plane that uses cross-account EventBridge messages to allow a single point of configuration for the front end.

Status: Not started
