package team.prost.ixtrust.client.auth.dto;

public record AuthResponse(
        String accessToken,
        String refreshToken,
        String name,
        String email,
        String role
) { }
