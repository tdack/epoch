# Fixtures

Synthesized from `cf schema` and the Cloudflare API reference for `cf` 1.0.0-beta.13, not recorded
from a real account. `./setup spike` saves the real responses under `.epoch/spike/`;
replace these files with them (after removing anything personal) once the owner has run it.

`tags-resources-list.json` and `tags-get-untagged.json` are real `cf tags resources list` and
`cf account-tags get` output recorded on 11 October 2026 (another project's tags, same shapes).

`build-trigger.json` is the trigger `cf builds triggers update` printed on the owner's account on
12 October 2026 (cf 1.0.0-beta.14), with its ids replaced and the build commands set back to the old
ones. `cf builds triggers list` is assumed to print a list of these.

`dns-records-list.json`, `workers-routes-list.json` and `workers-domains-list.json`, for
`./setup subdomains`, are synthesized from the API reference (`GET /zones/{id}/dns_records`,
`GET /zones/{id}/workers/routes`, `GET /accounts/{id}/workers/domains`), shaped like the worked
example in `docs/proposal-tree-subdomains.md`: a website on `www` and a demo on `demo` as Custom
Domains, and the Email Sending records, which are DNS-only.
