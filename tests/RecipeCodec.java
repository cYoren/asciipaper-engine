package io.github.cyoren.asciipaper;

import java.nio.charset.StandardCharsets;

// Interop test entry point; deliberately uses the production codec unchanged.
public final class RecipeCodec {
    public static void main(String[] args) throws Exception {
        String input = new String(System.in.readAllBytes(), StandardCharsets.UTF_8);
        System.out.print(args[0].equals("encode") ? Recipe.encode(input) : Recipe.decode(input));
    }
}
