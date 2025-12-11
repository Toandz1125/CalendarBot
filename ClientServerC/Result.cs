using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Text;
using System.Threading.Tasks;

namespace ClientServerC
{
    public class Result<T>
    {
        /// <summary>
        /// Indicates whether the operation was successful.
        /// </summary>
        public bool Success { get; set; }

        /// <summary>
        /// A message providing more details about the result (e.g., success message or error description).
        /// </summary>
        public string Message { get; set; }

        /// <summary>
        /// The data returned by the operation (can be null if there's no data or if the operation failed).
        /// </summary>
        public T Data { get; set; }

        /// <summary>
        /// Optional error code for more specific error handling (e.g., "NOT_FOUND", "UNAUTHORIZED").
        /// </summary>
        public string ErrorCode { get; set; }

        /// <summary>
        /// HTTP status code for the response (e.g., 200, 400, 404, etc.).
        /// </summary>
        public HttpStatusCode StatusCode { get; set; }

        // Constructor for success case
        public static Result<T> SuccessResult(T data, string message = "Success", HttpStatusCode statusCode = HttpStatusCode.OK)
        {
            return new Result<T>
            {
                Success = true,
                Message = message,
                Data = data,
                StatusCode = statusCode
            };
        }

        // Constructor for failure case
        public static Result<T> FailureResult(string message, string errorCode = null, HttpStatusCode statusCode = HttpStatusCode.BadRequest)
        {
            return new Result<T>
            {
                Success = false,
                Message = message,
                ErrorCode = errorCode,
                Data = default,
                StatusCode = statusCode
            };
        }
    }
}
