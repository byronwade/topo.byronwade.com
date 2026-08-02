# @topo/endpoint-adapter

The public, versioned extension contract for API endpoint discovery. Endpoint
adapters receive Topo's existing immutable source snapshot and return normalized
HTTP operations plus visible source issues. They never walk the project or read
outside that snapshot.
