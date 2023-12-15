# Tag Emitter Node

This node designed to keep track of common variables in the Node-RED flows. These variables called tags
and they have a few properties. This node can be used to create and read tags.

Main purpose of this node is to keep track of .value property of the tags and emit them to the other nodes on change.

This node uses Node-RED context to store tags. So, if global context is not persistent, tags will be lost on restart.
Once `filesystem` context is used, tags will be stored in the file system and will be available after restart.

## Usage
Use `Tag-In` node to write tags. Use `Tag-Emit` node to subscribe to changes of the tag values.

## Testing
To run tests, use `npm test` command.

## TODOs
 - [ ] Add support for deleting tags
 - [ ] Add support for updating tags

