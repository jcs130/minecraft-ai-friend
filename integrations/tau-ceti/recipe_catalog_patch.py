"""Reviewable compatibility changes over the pinned recipe reader, never the upstream checkout."""

def once(source, old, new):
    if source.count(old) != 1:
        raise ValueError('Pinned recipe reader changed; review compatibility patch')
    return source.replace(old, new)


def patch(source):
    # Context-sensitive display results must not discard unrelated valid recipes.
    source = once(source,
        'int offset = number(input, "offset", 0, 0, 10000), limit = number(input, "limit", 6, 1, 12);',
        'int offset = number(input, "offset", 0, 0, 10000), limit = number(input, "limit", 6, 1, 12);\n        int unreadable = 0;')
    source = once(source,
        'String nativeType = BuiltInRegistries.RECIPE_TYPE.getKey(holder.value().getType()).toString();',
        'String nativeType;\n            try { nativeType = BuiltInRegistries.RECIPE_TYPE.getKey(holder.value().getType()).toString(); }\n            catch (RuntimeException invalid) { unreadable++; continue; }')
    source = once(source,
        'if (!hasOutput(player, holder.value(), output)) continue;',
        'try { if (!hasOutput(player, holder.value(), output)) continue; }\n                catch (RuntimeException contextual) { unreadable++; continue; }')
    source = once(source,
        'result.addProperty("matchedCount", matched.size()); result.addProperty("offset", offset);',
        'result.addProperty("matchedCount", matched.size()); result.addProperty("offset", offset);\n        result.addProperty("unreadableRecipeCount", unreadable);\n        result.addProperty("filterCoverageComplete", unreadable == 0);\n        result.addProperty("matchedCountIsLowerBound", unreadable > 0);')
    source = once(source,
        'JsonObject value = definition(player, holder);',
        '''JsonObject value;
        try { value = definition(player, holder); }
        catch (RuntimeException unsupported) {
            value = new JsonObject(); value.addProperty("recipeId", holder.id().toString());
            value.addProperty("definitionAvailable", false); value.addProperty("code", "recipe_definition_unavailable");
        }''')
    return source
