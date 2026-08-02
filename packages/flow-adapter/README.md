# @topo/flow-adapter

The public, versioned extension seam for automatic flow discovery.

An adapter implements one `scan(context)` method. The context contains the
scanner's immutable source snapshot plus exact screen-to-source ownership. An
adapter returns source-located transition evidence and issues; it never writes
`.topo/flows`, starts the application, evaluates project code, or receives
preview credentials.
