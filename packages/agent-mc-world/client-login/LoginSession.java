package org.cortico.minecraft;

import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

/** One password submission per matching server connection. */
public final class LoginSession {
    public enum Result { IGNORE, SUBMIT, CONFIRMED, BLOCKED }
    /** A server may send more than one join packet on the same transport. */
    public static final class ConnectionScope {
        private Object transport;
        private long generation;

        public boolean join(Object current) {
            if (current == null || current == transport) return false;
            transport = current;
            generation++;
            return true;
        }

        public boolean disconnect(Object current) {
            if (current == null || current != transport) return false;
            transport = null;
            generation++;
            return true;
        }

        public long generation() { return generation; }
    }
    private static final Pattern FORMATTING = Pattern.compile("§[0-9A-FK-ORa-fk-or]");
    private final List<String> requests;
    private final List<String> confirmations;
    private final List<String> failures;
    private boolean attempted;
    private boolean finished;

    public LoginSession(List<String> requests, List<String> confirmations, List<String> failures) {
        this.requests = List.copyOf(requests);
        this.confirmations = List.copyOf(confirmations);
        this.failures = List.copyOf(failures);
    }

    public Result observe(String message) {
        if (finished) return Result.IGNORE;
        String text = FORMATTING.matcher(message).replaceAll("").stripLeading();
        // A player's quoted message cannot trigger password submission.
        if (matches(text, failures)) { finished = true; return Result.BLOCKED; }
        if (matches(text, confirmations)) { finished = true; return Result.CONFIRMED; }
        if (!attempted && matches(text, requests)) { attempted = true; return Result.SUBMIT; }
        return Result.IGNORE;
    }

    private static boolean matches(String text, List<String> markers) {
        return markers.stream().filter(marker -> !marker.isBlank())
            .anyMatch(marker -> text.startsWith(marker) || text.startsWith("[" + marker + "]"));
    }

    public static boolean matchesAccount(String expectedServer, String expectedUsername,
                                         String actualServer, String actualUsername) {
        return address(expectedServer).equals(address(actualServer))
            && !expectedUsername.isBlank() && expectedUsername.equals(actualUsername);
    }

    private static String address(String value) {
        String address = value.strip().toLowerCase(Locale.ROOT);
        return address.indexOf(':') < 0 ? address + ":25565" : address;
    }

    public static String command(String verb, String password) {
        if (!verb.matches("[a-z][a-z0-9_]*") || password.isBlank()
                || password.length() > 128 || password.chars().anyMatch(Character::isWhitespace))
            throw new IllegalArgumentException("Invalid login credential or command");
        return verb + " " + password;
    }
}
